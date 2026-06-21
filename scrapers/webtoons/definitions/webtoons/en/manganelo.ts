import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class ManganeloScraper extends BaseScraper {
  override readonly name = 'Manganato';
  override readonly baseUrl = 'https://www.natomanga.com';
  override readonly lang = 'en';

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/search/${encodeURIComponent(query)}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div.item').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('a').first();
      const img = $el.find('img').first();
      return {
        title: a.attr('title') || img.attr('alt') || '',
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: false };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div.item').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('a').first();
      const img = $el.find('img').first();
      return {
        title: a.attr('title') || img.attr('alt') || '',
        url: this.absUrl(a.attr('href') || ''),
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
    const img = $('img[src*="/manga/"]').first();
    const thumbnailUrl = this.absUrl(img.attr('src') || '');
    const description = $('div#noidung').first().text().trim();
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, description: description || undefined };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('li[class*="chapter"] a, a[href*="/chapter/"]').toArray().map(el => {
      const $el = $(el);
      return { name: $el.text().trim(), url: this.absUrl($el.attr('href') || '') };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('img[src*="/manga/"], img[src*="/uploads/"]').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}
