import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class Photos18Scraper extends BaseScraper {
  readonly name = 'Photos18';
  readonly baseUrl = 'https://www.photos18.com';
  readonly lang = 'all';

  private useTrad = false;
  private categories: { label: string; value: string }[] = [];

  private get baseUrlWithLang(): string {
    return this.useTrad ? this.baseUrl : `${this.baseUrl}/zh-hans`;
  }

  private stripLang(path: string): string {
    return path.replace(/^\/zh-hans/, '');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrlWithLang}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    return this._parseGalleryPage(res.data);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrlWithLang}/sort/views?page=${page}`);
    return this._parseGalleryPage(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrlWithLang}/?page=${page}`);
    return this._parseGalleryPage(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('title').first().text() || undefined,
      url: mangaUrl,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Gallery', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const content = $('#content').first();
    return content.find('img').toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }

  private _parseGalleryPage(html: string): SearchResult {
    const $ = this.$(html);
    const videos = $('#videos').first();
    const mangas: Manga[] = videos.children().toArray().map(child => {
      const $child = $(child);
      const cardBody = $child.find('.card-body').first();
      const link = cardBody.find('a').first();
      const img = $child.find('img').first();
      const label = cardBody.find('label').first();
      const href = link.attr('href') || '';
      return {
        title: link.text(),
        url: this.stripLang(href),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        genre: label.text() || undefined,
        lang: this.lang,
        status: 'completed',
      };
    });
    const next = $('.next').first();
    const hasNextPage = next.length > 0 && !next.hasClass('disabled');
    return { mangas, hasNextPage };
  }
}
