import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HonkaiimpactScraper extends BaseScraper {
  readonly name = 'Honkai Impact 3rd';
  readonly baseUrl = 'https://manga.honkaiimpact3.com';
  readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/book`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('a[href*=book]').toArray().map(el => {
      const $el = $(el);
      const url = this.absUrl($el.attr('href') || '');
      const title = $el.find('.container-title').text();
      const thumbnailUrl = this.absUrl($el.find('.container-cover img').attr('src') || '');
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    return { mangas, hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(_query: string, _page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('div.title').text();
    const thumbnailUrl = this.absUrl($('img.cover').attr('src') || '');
    const description = $('div.detail_info1').text() || undefined;
    return { title, url: mangaUrl, thumbnailUrl, description, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = mangaUrl.endsWith('/get_chapter') ? mangaUrl : `${mangaUrl}/get_chapter`;
    const res = await this.get(url);
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const list = Array.isArray(data) ? data : [];
    return list.map((ch: any) => ({
      name: ch.name || ch.title || `Chapter ${ch.number || ''}`,
      url: ch.url || ch.id?.toString() || '',
      chapterNumber: ch.number || undefined,
      dateUpload: ch.created_at ? new Date(ch.created_at).getTime() : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('img.lazy.comic_img').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('data-original') || ''),
    }));
  }
}
