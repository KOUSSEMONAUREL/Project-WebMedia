import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class Hentai3Scraper extends BaseScraper {
  readonly name = '3Hentai';
  readonly baseUrl = 'https://3hentai.net';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/search?q=pages%3A>0&page=${page}&sort=popular`);
    return this.parseListing(response.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    if (page > 1) url.searchParams.set('page', page.toString());
    url.searchParams.set('sort', '');
    const response = await this.get(url.toString());
    return this.parseListing(response.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('a[href*=/d/]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('div.title').first().text();
      const href = $el.attr('href') ?? '';
      const url = href ? this.absUrl(href) : '';
      const img = $el.find('img').first();
      const src = img.attr('data-src') || img.attr('src') || '';
      const thumbnailUrl = src ? this.absUrl(src) : '';
      mangas.push({ url: url.replace(this.baseUrl, ''), title, thumbnailUrl, lang: this.lang });
    });
    const hasNextPage = $('a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const capitalizeEach = (s: string) => s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const authors = $('a[href*=/groups/]').map((_, el) => $(el).text()).get().join(', ');
    const artists = $('a[href*=/artists/]').map((_, el) => $(el).text()).get().join(', ');
    const genre = $('a[href*=/tags/]').map((_, el) => {
      const t = $(el).text();
      const c = capitalizeEach(t);
      if (c.includes('male')) return c.replace('(female)', '\u2640').replace('(male)', '\u2642');
      return `${c} \u25ca`;
    }).get().join(', ');
    const descParts: string[] = [];
    const chars = $('a[href*=/characters/]').map((_, el) => $(el).text()).get().join(', ');
    if (chars) descParts.push(`Characters: ${capitalizeEach(chars)}\n`);
    const series = $('a[href*=/series/]').map((_, el) => $(el).text()).get().join(', ');
    if (series) descParts.push(`Series: ${capitalizeEach(series)}\n`);
    const groups = $('a[href*=/groups/]').map((_, el) => $(el).text()).get().join(', ');
    if (groups) descParts.push(`Groups: ${capitalizeEach(groups)}\n`);
    const languages = $('a[href*=/language/]').map((_, el) => $(el).text()).get().join(', ');
    if (languages) descParts.push(`Languages: ${capitalizeEach(languages)}\n`);
    const pages = $('div.tag-container').filter((_, el) => /pages:/i.test($(el).text())).first().text();
    descParts.push(pages + '\n');
    const cover = $('img').first();
    const coverSrc = cover.attr('data-src') || cover.attr('src') || '';

    return {
      title: $('h1 > span').text() || $('h1').text(),
      author: authors || artists || undefined,
      artist: artists || authors || undefined,
      genre: genre || undefined,
      description: descParts.join('').trim() || undefined,
      thumbnailUrl: coverSrc ? this.absUrl(coverSrc) : '',
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const dateStr = $('time').attr('datetime');
    const parsed = dateStr ? new Date(dateStr).getTime() : NaN;
    const dateUpload = Number.isNaN(parsed) ? undefined : parsed;
    return [{ name: 'Chapter', url: mangaUrl, dateUpload }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('img[data-src]').each((_, el) => {
      const src = $(el).attr('data-src') ?? '';
      if (!src || /thumb|cover/.test(src)) return;
      const imageUrl = this.absUrl(src).replace(/t(?=\.)/, '');
      pages.push({ index: pages.length, imageUrl });
    });
    return pages;
  }
}
