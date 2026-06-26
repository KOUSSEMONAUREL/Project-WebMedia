import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MangaBTTScraper extends BaseScraper {
  readonly name = 'MangaBTT';
  readonly baseUrl = 'https://manhwabtt.cc';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get('/find-story', { params: { page: String(page), status: '1', sort: '2' } });
    return this._parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get('/find-story', { params: { page: String(page), status: '1', sort: '8' } });
    return this._parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get('/find-story', { params: { keyword: query, page: String(page) } });
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('h1.title-detail').text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.detail-info img').attr('data-lazy-src') ?? $('.detail-info img').attr('data-src') ?? $('.detail-info img').attr('src') ?? ''),
      description: $('.detail-content p').text().trim() || undefined,
      author: $('.author p:not(.name)').text().trim() || undefined,
      status: $('.status p:not(.name)').text().toLowerCase().includes('ongoing') ? 1 : $('.status p:not(.name)').text().toLowerCase().includes('completed') ? 2 : 0,
      genre: $('.kind a').map((_: any, el: any) => $(el).text()).get().join(', '),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const storyId = mangaUrl.split('-').pop() || '';
    const res = await this.post('/Story/ListChapterByStoryID', new URLSearchParams({ StoryID: storyId }).toString(), {
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul > li:not(.heading)').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim();
      const dateText = $(el).find('.col-xs-4').text().trim();
      let dateUpload: number | undefined;
      if (dateText) {
        const dateNum = this._parseRelativeDate(dateText);
        if (dateNum) dateUpload = dateNum;
      }
      if (name && href) chapters.push({ name, url: href, dateUpload });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.reading-detail > .page-chapter img[data-index]').each((_, el) => {
      const index = parseInt($(el).attr('data-index') || '0');
      const url = $(el).attr('data-lazy-src') ?? $(el).attr('data-src') ?? $(el).attr('src') ?? '';
      if (url) pages.push({ index, imageUrl: this.absUrl(url) });
    });
    return pages.sort((a, b) => a.index - b.index);
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.items > .row > .item').each((_, el) => {
      const $el = $(el);
      const a = $el.find('figcaption h3 a').first();
      const href = a.attr('href') ?? '';
      const title = a.text().trim();
      const thumb = $el.find('.image img').attr('data-lazy-src') ?? $el.find('.image img').attr('data-src') ?? $el.find('.image img').attr('src') ?? '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('ul.pagination > li.active + li:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  private _parseRelativeDate(dateStr: string): number | undefined {
    const now = Date.now();
    const match = dateStr.match(/(\d+)\s+(second|minute|hour|day|week|month|year)/);
    if (!match) return undefined;
    const num = parseInt(match[1]);
    const unit = match[2];
    const ms: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
    return now - num * (ms[unit] || 0);
  }
}
