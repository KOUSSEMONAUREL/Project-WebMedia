import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const AJAX_PATH = '/wp-admin/admin-ajax.php';

function parseStatus(value: string | undefined): MangaStatus {
  switch (value?.trim().toLowerCase()) {
    case 'ongoing':
      return 1;
    case 'completed':
      return 0;
    case 'dropped':
      return 2;
    default:
      return undefined;
  }
}

function parseChapterDate(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export class RinkoComicsScraper extends BaseScraper {
  readonly name = 'Rinko Comics';
  readonly baseUrl = 'https://rinkocomics.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse(page, 'views');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(page, 'updated');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = this.comicsUrl(page);
    const trimmed = query.trim();
    if (trimmed) url.searchParams.set('q', trimmed);
    const res = await this.get(url.toString());
    return this.parseComicsPage(res.data as string);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const genre = [
      this.info($, 'Type'),
      ...$('main a[href*="/comics_genres/"]').toArray().map(el => $(el).text().trim()),
    ].filter((value): value is string => Boolean(value));
    return {
      title: $('main h1').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: this.largestImage($('main aside img').first()),
      status: parseStatus(this.info($, 'Status')),
      genre: [...new Set(genre)].join(', ') || undefined,
      description: $('#cwSynopsis').first().text().trim() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const firstPage = this.parseChapterElements($, $('#cwChapters a.chapter-item').toArray());

    const moreButton = $('#cwMoreChapters').first();
    if (moreButton.length === 0) return firstPage;

    const comicId = (moreButton.attr('data-comic-id') ?? '').trim();
    const pageSize = Number(moreButton.attr('data-offset') ?? 0);
    const total = Number(this.info($, 'Chapters') ?? 0);
    const nonce = /"nonce"\s*:\s*"([^"]+)"/.exec($('script#comicworld-loadmore-js-extra').text())?.[1] ?? '';
    if (!comicId || !nonce || !Number.isFinite(pageSize) || pageSize <= 0 || !Number.isFinite(total)) {
      return firstPage;
    }

    const chapters = [...firstPage];
    for (let offset = pageSize; offset < total; offset += pageSize) {
      chapters.push(...await this.fetchMoreChapters(mangaUrl, comicId, offset, nonce));
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const payload = $('script#cwPages').first().text().trim();
    if (!payload) return [];
    const raw = Buffer.from(payload, 'base64');
    if (raw.length <= 16) return [];
    const decoded = Buffer.alloc(raw.length - 16);
    for (let i = 0; i < decoded.length; i++) {
      decoded[i] = raw[i + 16] ^ raw[i % 16];
    }
    const urls = JSON.parse(decoded.toString('utf8')) as unknown;
    if (!Array.isArray(urls)) return [];
    return urls
      .filter((url): url is string => typeof url === 'string')
      .map((imageUrl, index) => ({ index, imageUrl }));
  }

  private async browse(page: number, sort: string): Promise<SearchResult> {
    const url = this.comicsUrl(page);
    url.searchParams.set('sort', sort);
    const res = await this.get(url.toString());
    return this.parseComicsPage(res.data as string);
  }

  private comicsUrl(page: number): URL {
    return new URL(page <= 1 ? '/comic/' : `/comic/page/${page}/`, this.baseUrl);
  }

  private parseComicsPage(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('#cwBrowse ul > li > a').each((_, element) => {
      const card = $(element);
      const title = card.children('span').eq(1).text().trim();
      const url = (card.attr('href') ?? '').trim();
      if (!title || !url) return;
      mangas.push({
        title,
        url: this.absUrl(url),
        thumbnailUrl: this.largestImage(card.find('img').first()),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('nav[aria-label="Pages"] a.next').length > 0 };
  }

  private parseChapterElements($: CheerioAPI, elements: Element[]): Chapter[] {
    const chapters: Chapter[] = [];
    for (const element of elements) {
      const item = $(element);
      if (item.attr('data-reason') !== undefined) continue;
      const url = (item.attr('href') ?? '').trim();
      if (!url || url === '#') continue;
      const spans = item.children('span').first().children('span');
      const name = spans.eq(0).text().trim();
      if (!name) continue;
      chapters.push({
        name,
        url: this.absUrl(url),
        dateUpload: parseChapterDate(spans.eq(1).text().split(' · ')[0].trim()),
      });
    }
    return chapters;
  }

  private async fetchMoreChapters(
    mangaUrl: string,
    comicId: string,
    offset: number,
    nonce: string,
  ): Promise<Chapter[]> {
    const body = new URLSearchParams({
      action: 'load_more_chapters',
      nonce,
      comic_id: comicId,
      offset: String(offset),
      order: 'desc',
      ui: 'v2',
    });
    const res = await this.post(AJAX_PATH, body, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: mangaUrl },
    });
    const data = res.data as { data?: { html?: string } };
    const html = data.data?.html ?? '';
    if (!html) return [];
    const $ = this.$(html);
    return this.parseChapterElements($, $('a.chapter-item').toArray());
  }

  private info($: CheerioAPI, label: string): string | undefined {
    const term = $('main dt')
      .filter((_, element) => $(element).text().trim() === label)
      .first();
    const value = term.next('dd').text().trim();
    return value || undefined;
  }

  private largestImage(image: Cheerio<Element>): string {
    const srcset = image.attr('srcset');
    if (srcset) {
      const best = srcset.split(',')
        .map(part => part.trim().split(/\s+/))
        .map(([url, width]) => ({ url, width: Number((width ?? '').replace(/w$/, '')) }))
        .filter(candidate => candidate.url && Number.isFinite(candidate.width))
        .sort((a, b) => b.width - a.width)[0];
      if (best) return this.absUrl(best.url);
    }
    return this.absUrl(image.attr('src') ?? '');
  }
}

export default RinkoComicsScraper;
