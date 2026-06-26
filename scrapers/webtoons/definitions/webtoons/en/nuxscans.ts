import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class NuxScansScraper extends BaseScraper {
  readonly name = 'Nux Scans';
  readonly baseUrl = 'https://nuxscans-comics.blogspot.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this._parseList((await this.get(this.baseUrl)).data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this._parseList((await this.get(this.baseUrl)).data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this._parseList((await this.get(`/search`, { params: { q: query } })).data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('h1.post-title').first().text() || $('h1').text() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.post-thumbnail img').first().attr('src') || ''),
      description: $('.post-details h3:contains(Synopsis) + p').text().trim() || $("meta[name=description]").attr("content") || undefined,
      author: $('.post-details p:contains(Author:)').text().replace(/^Author:\s*/i, '').trim() || undefined,
      status: (() => {
        const s = $('.post-details p:contains(Status:)').text();
        if (s.includes('Ongoing')) return 1;
        if (s.includes('Completed')) return 2;
        return 0;
      })(),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.row-chapters .list-item a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const name = $(el).text().trim();
      if (name && href) {
        const chapterNumber = parseFloat(name);
        chapters.push({ name, url: this.absUrl(href), chapterNumber: isNaN(chapterNumber) ? undefined : chapterNumber });
      }
    });
    if (chapters.length > 0) return chapters.reverse();
    return [{ name: $('h1.post-title').text().trim() || $('h1').text().trim() || 'Chapter', url: mangaUrl, chapterNumber: 1 }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.post-body img, .holder img').each((i, el) => {
      const src = this.absUrl($(el).attr('src') || $(el).attr('data-src') || '');
      const srcLower = src.toLowerCase();
      if (src && !srcLower.includes('logo') && !srcLower.includes('footer') && !srcLower.includes('credit') && !$(el).hasClass('watermark')) {
        pages.push({ index: i, imageUrl: src });
      }
    });
    return pages;
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.index-post').each((_, el) => {
      const $el = $(el);
      const a = $el.find('.post-title a').first();
      const href = a.attr('href') ?? '';
      const title = a.text().trim();
      const img = $el.find('.post-thumb').first();
      const thumb = img.attr('data-src') || img.attr('src') || '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    return { mangas, hasNextPage: false };
  }
}
