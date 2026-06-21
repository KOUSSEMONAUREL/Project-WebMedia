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
      const url = $el.attr('abs:href') || '';
      const thumbnailUrl = $el.find('img:not([class])').first().attr('abs:src') || '';
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
    descParts.push($('div.tag-container:contains(pages:)').text() + '\n');

    return {
      title: $('h1 > span').text() || $('h1').text(),
      author: authors || artists || undefined,
      artist: artists || authors || undefined,
      genre: genre || undefined,
      description: descParts.join('').trim() || undefined,
      thumbnailUrl: $('img[src*=thumbnail].w-96').first().attr('abs:src') || '',
      status: 1,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const dateStr = $('time').text();
    const dateUpload = dateStr ? new Date(dateStr).getTime() : undefined;
    return [{ name: 'Chapter', url: mangaUrl, dateUpload }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('img:not([class], [src*=thumb], [src*=cover])').each((i, el) => {
      const imageUrl = ($(el).attr('abs:src') || '').replace(/t(?=\.)/, '');
      pages.push({ index: i, imageUrl });
    });
    return pages;
  }
}
