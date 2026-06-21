import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class ErofusScraper extends BaseScraper {
  override readonly name = 'Erofus';
  override readonly baseUrl = 'https://www.erofus.com';
  override readonly lang = 'en';

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/comics?search=${encodeURIComponent(query)}&sort=recent&page=1`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('a.a-click').toArray().map(el => {
      const $el = $(el);
      const img = $el.find('img').first();
      return {
        title: $el.attr('title') || img.attr('alt') || '',
        url: this.absUrl($el.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: false };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/comics/various-authors?sort=viewed&page=1`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('a.a-click').toArray().map(el => {
      const $el = $(el);
      const img = $el.find('img').first();
      return {
        title: $el.attr('title') || img.attr('alt') || '',
        url: this.absUrl($el.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/comics/various-authors?sort=recent&page=1`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('a.a-click').toArray().map(el => {
      const $el = $(el);
      const img = $el.find('img').first();
      return {
        title: $el.attr('title') || img.attr('alt') || '',
        url: this.absUrl($el.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string) {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1').first().text().trim();
    const img = $('a.a-click img').first();
    const thumbnailUrl = this.absUrl(img.attr('src') || '');
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('a.a-click[href^=/comics/]').toArray().map(el => {
      const $el = $(el);
      const img = $el.find('img').first();
      return { name: $el.attr('title') || img.attr('alt') || '', url: this.absUrl($el.attr('href') || '') };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('a.a-click img[src*="/thumb/"]').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || '').replace('/thumb/', '/medium/'),
    }));
  }
}
