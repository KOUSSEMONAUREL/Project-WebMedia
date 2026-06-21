import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class EighteenporncomicScraper extends BaseScraper {
  override readonly name = '18 Porn Comic';
  override readonly baseUrl = 'https://18porncomic.com';
  override readonly lang = 'en';

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?s=${encodeURIComponent(query)}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div.page-item-detail').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('div.post-title a').first();
      const img = $el.find('img').first();
      return {
        title: a.text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || img.attr('data-src') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: $('a.next').length > 0 };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/manga/?m_orderby=views`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div.page-item-detail').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('div.post-title a').first();
      const img = $el.find('img').first();
      return {
        title: a.text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || img.attr('data-src') || ''),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: $('a.next').length > 0 };
  }

  async getMangaDetails(mangaUrl: string) {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('div.post-title h1').first().text().trim();
    const img = $('div.summary_image img').first();
    const thumbnailUrl = this.absUrl(img.attr('src') || img.attr('data-src') || '');
    const description = $('div.description-summary div.summary__content').first().text().trim();
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, description: description || undefined };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('li.wp-manga-chapter').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('a').first();
      return { name: a.text().trim(), url: this.absUrl(a.attr('href') || '') };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.page-break img, div.reading-content img').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || $(el).attr('data-src') || ''),
    }));
  }
}
