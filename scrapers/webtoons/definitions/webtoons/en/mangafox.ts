import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MangaFoxScraper extends BaseScraper {
  readonly name = 'MangaFox';
  readonly baseUrl = 'https://fanfox.net';
  readonly lang = 'en';
  private mobileHost = 'https://m.fanfox.net';
  private lastReq = 0;

  private async rateLimitedGet(url: string) {
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - this.lastReq));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastReq = Date.now();
    return this.get(url);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const path = page === 1 ? '/directory/' : `/directory/${page}.html`;
    const res = await this.rateLimitedGet(path);
    return this.parsePopularList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const path = page === 1 ? '/directory/?latest' : `/directory/${page}.html?latest`;
    const res = await this.rateLimitedGet(path);
    return this.parsePopularList(res.data);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.rateLimitedGet(`/search?title=${encodeURIComponent(query)}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('ul.manga-list-4-list li').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const title = a.attr('title') || a.text().trim();
      const url = this.absUrl(a.attr('href') || '');
      const thumbnailUrl = this.absUrl($el.find('img').attr('src') || '');
      if (title && url) mangas.push({ title, url, thumbnailUrl, lang: this.lang });
    });
    return { mangas, hasNextPage: false };
  }

  private parsePopularList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('ul.manga-list-1-list li').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const title = a.attr('title') || a.text().trim();
      const url = this.absUrl(a.attr('href') || '');
      const thumbnailUrl = this.absUrl($el.find('img').attr('src') || '');
      if (title && url) mangas.push({ title, url, thumbnailUrl, lang: this.lang });
    });
    const hasNextPage = $('.pager-list-left a.active + a + a').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.rateLimitedGet(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.detail-info-right-title-font').first().text().trim();
    const thumbnailUrl = this.absUrl($('.detail-info-cover-img').attr('src') || '');
    const author = $('.detail-info-right-say a').first().text().trim() || undefined;
    const genre = $('.detail-info-right-tag-list a').toArray().map(el => $(el).text().trim()).join(', ');
    const description = $('p.fullcontent').first().text().trim() || undefined;
    const statusEl = $('.detail-info-right-title-tip').first().text().trim().toLowerCase();
    let status: import('../../../engine/types').MangaStatus;
    if (statusEl.includes('ongoing')) status = 1;
    else if (statusEl.includes('completed')) status = 0;
    return {
      title, url: mangaUrl, thumbnailUrl, author, genre, description, status, lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.rateLimitedGet(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul.detail-main-list li a').each((_, el) => {
      const $el = $(el);
      const name = $el.find('p:first-child').text().trim();
      const url = this.absUrl($el.attr('href') || '');
      const dateText = $el.find('p:last-child').text().trim();
      const dateUpload = this.parseDate(dateText);
      if (name && url) chapters.push({ name, url, dateUpload });
    });
    return chapters;
  }

  private parseDate(text: string): number | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();
    if (lower === 'today') {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
    }
    if (lower.includes('ago')) {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
    }
    if (lower === 'yesterday') {
      const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d.getTime();
    }
    const d = new Date(text);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const rollUrl = chapterUrl.replace('/manga/', '/roll_manga/').replace('https://fanfox.net', 'https://m.fanfox.net');
    const res = await this.rateLimitedGet(rollUrl);
    const $ = this.$(res.data);
    return $('#viewer img').toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('data-original') || $(el).attr('src') || ''),
    })).filter(p => p.imageUrl);
  }
}
