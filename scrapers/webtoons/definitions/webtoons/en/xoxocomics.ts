import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class XoxocomicsScraper extends BaseScraper {
  override readonly name = 'XOXO Comics';
  override readonly baseUrl = 'https://xoxocomic.com';
  override readonly lang = 'en';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/search-comic?keyword=${encodeURIComponent(query)}&page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('li.row').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('h3 a').first();
      const img = $el.find('img').first();
      return {
        title: a.text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || img.attr('data-original') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: $('a.next').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/hot-comic?page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('li.row').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('h3 a').first();
      const img = $el.find('img').first();
      return {
        title: a.text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || img.attr('data-original') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: $('a.next').length > 0 };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/comic-update?page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('li.row').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('h3 a').first();
      const img = $el.find('img').first();
      return {
        title: a.text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || img.attr('data-original') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: $('a.next').length > 0 };
  }

  async getMangaDetails(mangaUrl: string) {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1').first().text().trim();
    const img = $('div.thumb img').first();
    const thumbnailUrl = this.absUrl(img.attr('src') || img.attr('data-original') || '');
    const description = $('div.desc').first().text().trim();
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, description: description || undefined };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul.chapter-list li, li.row:has(a[href*="/chapter/"])').toArray().forEach(el => {
      const $el = $(el);
      const a = $el.find('a').first();
      const dateText = $el.find('div.col-xs-3').text().trim();
      const dateUpload = dateText ? new Date(dateText).getTime() || undefined : undefined;
      chapters.push({
        name: a.text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        dateUpload,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${chapterUrl}/all`);
    const $ = this.$(res.data);
    return $('img[src*="/uploads/"], img[src*="/comics/"]').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || $(el).attr('data-src') || ''),
    }));
  }
}
