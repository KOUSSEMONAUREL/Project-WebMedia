import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const IMAGE_TYPES: Record<string, string> = {
  j: 'jpg',
  p: 'png',
  b: 'bmp',
  g: 'gif',
  w: 'webp',
};

function parseRelativeDate(text: string): number | undefined {
  const value = text.replace(/^Uploaded\s+/i, '').trim();
  const absolute = Date.parse(value);
  if (!Number.isNaN(absolute)) return absolute;
  const match = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multipliers: Record<string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };
  return Date.now() - amount * (multipliers[match[2].toLowerCase()] ?? 0);
}

export class HentaiClapScraper extends BaseScraper {
  readonly name = 'HentaiClap';
  readonly baseUrl = 'https://hentaiclap.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = page > 1 ? `${this.baseUrl}/?page=${page}` : `${this.baseUrl}/`;
    const res = await this.get(url);
    return this.parseListing(String(res.data));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL('/search/', this.baseUrl);
    url.searchParams.set('key', query.trim());
    url.searchParams.set('sort', 'popular');
    if (page > 1) url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    return this.parseListing(String(res.data));
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('div.thumb').toArray().map(element => {
      const item = $(element);
      const link = item.find('.inner_thumb a').first();
      const href = link.attr('href') ?? '';
      const title = item.find('h2').first().text().trim();
      if (!href || !title) return undefined;
      const img = item.find('.inner_thumb img').first();
      return {
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.imgAttr(img),
        lang: this.lang,
      } as Manga;
    }).filter((manga): manga is Manga => Boolean(manga));
    const hasNextPage = $('.pagination li.active + li:not(.disabled), a[rel="next"]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const artists = this.info($, 'Artists');
    const groups = this.info($, 'Groups');
    const description = ['Parodies', 'Characters', 'Groups', 'Languages', 'Categories', 'Category']
      .map(tag => [tag, this.info($, tag)] as const)
      .filter(([, values]) => values.length > 0)
      .map(([tag, values]) => `${tag}: ${values.join(', ')}`);
    const pages = $('.pages').first().text().replace(/^Pages\s+/i, '').trim();
    if (pages) description.push(`Pages: ${pages}`);
    const alternative = $('h1 + h2, .subtitle').first().text().trim();
    if (alternative) description.push(`Alternative title: ${alternative}`);
    return {
      title: $('h1').first().text().trim(),
      url: this.absUrl(mangaUrl),
      thumbnailUrl: this.imgAttr($('.gt_cover img').first()),
      lang: this.lang,
      author: (artists.length > 0 ? artists : groups).join(', ') || undefined,
      artist: artists.join(', ') || undefined,
      genre: this.info($, 'Tags').join(', ') || undefined,
      description: description.join('\n\n') || undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean).pop() ?? '';
    if (!id) return [];
    const res = await this.get(`/gallery/${id}/`);
    const $ = this.$(String(res.data));
    const added = $('.added').first().text();
    return [{
      name: 'Chapter',
      url: `${this.baseUrl}/gallery/${id}/`,
      scanlator: this.info($, 'Groups').join(', ') || undefined,
      dateUpload: added ? parseRelativeDate(added) : undefined,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = new URL(this.absUrl(chapterUrl)).pathname.split('/').filter(Boolean).pop() ?? '';
    if (!id) return [];
    const res = await this.get(`/read/${id}/1/`);
    const html = String(res.data);
    const $ = this.$(html);
    const dir = $('input#image_dir').attr('value') ?? '';
    const gallery = $('input#gallery_id').attr('value') ?? '';
    const server = $('input#server_id').attr('value') ?? '';
    const json = /var g_th\s*=\s*(\{[\s\S]*?\})\s*;/.exec(html);
    if (!dir || !gallery || !server || !json) return [];
    let entries: Record<string, string>;
    try {
      entries = JSON.parse(json[1]) as Record<string, string>;
    } catch {
      return [];
    }
    const host = `m${server}.${new URL(this.baseUrl).host}`;
    return Object.entries(entries)
      .map(([number, info]) => ({ number: Number(number), info }))
      .filter(entry => Number.isInteger(entry.number))
      .sort((a, b) => a.number - b.number)
      .map((entry, index) => ({
        index,
        imageUrl: `https://${host}/${dir}/${gallery}/${entry.number}.${IMAGE_TYPES[entry.info.split(',')[0]] ?? 'jpg'}`,
      }));
  }

  private imgAttr(element: Cheerio<Element>): string {
    if (element.length === 0) return '';
    return this.absUrl(
      element.attr('data-cfsrc')
      || element.attr('data-src')
      || element.attr('data-lazy-src')
      || element.attr('src')
      || ''
    );
  }

  private info($: CheerioAPI, tag: string): string[] {
    const values = $(`ul:has(> .ri_txt:contains(${tag})) a`).toArray().map(element => {
      const link = $(element);
      const own = link.clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
      const split = link.find('.split_tag').text().replace(/^\|\s*/, '').trim();
      return [own, split].filter(Boolean).join(', ');
    }).filter(Boolean);
    return [...new Set(values)];
  }
}

export default HentaiClapScraper;
