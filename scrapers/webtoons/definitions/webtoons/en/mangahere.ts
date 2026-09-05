import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MangahereScraper extends BaseScraper {
  readonly name = 'Mangahere';
  readonly baseUrl = 'https://www.mangahere.cc';
  readonly lang = 'en';

  private lastReq = 0;

  private async rateLimitedGet(url: string) {
    const now = Date.now();
    const wait = Math.max(0, 2000 - (now - this.lastReq));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastReq = Date.now();
    return this.get(url, { headers: { Cookie: 'isAdult=1', Referer: `${this.baseUrl}/` } });
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.rateLimitedGet(`${this.baseUrl}/directory/${page}.htm`);
    return this.parseList(res.data, '.manga-list-1-list li');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.rateLimitedGet(`${this.baseUrl}/directory/${page}.htm?latest`);
    return this.parseList(res.data, '.manga-list-1-list li');
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return this.getPopular(1);
    const url = `${this.baseUrl}/search?title=${encodeURIComponent(trimmed)}`;
    const res = await this.rateLimitedGet(url);
    return this.parseList(res.data, '.manga-list-4-list > li');
  }

  private parseList(html: string, selector: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $(selector).each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') || '';
      const title = a.attr('title') || a.text().trim();
      const img = a.find('img').attr('src') || $el.find('img').attr('src') || '';
      if (title && href) {
        mangas.push({
          title: title.trim(),
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(img),
          lang: this.lang,
        });
      }
    });
    const hasNextPage = $('div.pager-list-left a:last-child').length > 1;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.rateLimitedGet(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.detail-info-right .detail-info-right-title-font').first().text().trim() || $('h1').first().text().trim() || '';
    const author = $('.detail-info-right-say a').first().text().trim() || undefined;
    const genre = $('.detail-info-right-tag-list a').toArray().map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined;
    const description = $('p.fullcontent').first().text().trim() || undefined;
    const thumbnailUrl = this.absUrl($('.detail-info-cover-img').attr('src') || '');
    const statusText = $('.detail-info-right-title-tip').first().text().trim().toLowerCase();
    let status: Manga['status'];
    if (statusText.includes('ongoing')) status = 1;
    else if (statusText.includes('completed')) status = 0;
    else status = undefined;
    // Licensed check via first chapter page (best effort)
    try {
      const firstHref = $('ul.detail-main-list li a').first().attr('href');
      if (firstHref) {
        const chapRes = await this.rateLimitedGet(this.absUrl(firstHref));
        const $chap = this.$(chapRes.data);
        if ($chap('p.detail-block-content').text().trim()) status = 2;
      }
    } catch {
      // ignore
    }
    return { title, url: mangaUrl, thumbnailUrl, author, description, genre, status, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.rateLimitedGet(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul.detail-main-list > li a').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const name = $el.find('.detail-main-list-main p').first().text().trim() || $el.text().trim();
      const dateText = $el.find('.detail-main-list-main p').last().text().trim();
      const dateUpload = this.parseDate(dateText);
      if (href && name) chapters.push({ name, url: this.absUrl(href), dateUpload });
    });
    return chapters;
  }

  private parseDate(text: string): number | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase();
    if (lower === 'today' || lower.includes('ago')) {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
    }
    if (lower === 'yesterday') {
      const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return d.getTime();
    }
    const d = new Date(text);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.rateLimitedGet(chapterUrl);
    const $ = this.$(res.data);
    // Try viewer images (new site layout)
    const pages: Page[] = [];
    $('#viewer img, div#readerarea img').each((i, el) => {
      const src = $(el).attr('data-original') || $(el).attr('src') || $(el).attr('data-src') || '';
      if (src) pages.push({ index: i, imageUrl: this.absUrl(src) });
    });
    if (pages.length > 0) return pages;
    // Fallback generic
    $('img').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src && (src.includes('mangahere') || src.startsWith('http'))) {
        pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
      }
    });
    return pages;
  }
}
