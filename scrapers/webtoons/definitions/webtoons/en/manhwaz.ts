import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ManhwazScraper extends BaseScraper {
  override readonly name = 'ManhwaZ';
  override readonly baseUrl = 'https://manhwaz.cc';
  override readonly lang = 'en';

  private parseCards(html: string, selector: string): Manga[] {
    const $ = this.$(html);
    return $(selector).toArray().map(node => {
      const $node = $(node);
      const a = $node.find('h3 a').first();
      const img = $node.find('img').first();
      const href = a.attr('href') || '';
      const src = img.attr('src') || img.attr('data-src') || '';
      return {
        title: a.text().trim(),
        url: this.absUrl(href),
        thumbnailUrl: src.startsWith('http') || src.startsWith('//') ? this.absUrl(src) : this.absUrl(src),
        lang: this.lang,
      };
    });
  }

  private hasNextPage(html: string): boolean {
    const $ = this.$(html);
    return $('nav.pagination a[aria-label="Next page"]').length > 0;
  }

  /** The origin currently serves an `archive-fallback` snapshot with HTTP 503
   * (Cloudflare, `retry-after: 300`) that still carries the full catalogue.
   * Axios rejects non-2xx, so accept the fallback body instead of failing. */
  private async fetchHtml(url: string): Promise<string> {
    try {
      const res = await this.get(url);
      return typeof res.data === 'string' ? res.data : String(res.data);
    } catch (err) {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      if (typeof data === 'string' && data.includes('popular-card')) return data;
      throw err;
    }
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const html = await this.fetchHtml(this.baseUrl);
    const mangas = this.parseCards(html, 'article.popular-card');
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const html = await this.fetchHtml(`${this.baseUrl}/?page=${page}`);
    const mangas = this.parseCards(html, 'article.latest-card');
    return { mangas, hasNextPage: this.hasNextPage(html) };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const q = query.trim();
    let path: string;
    if (q) {
      path = `/search?s=${encodeURIComponent(q)}&page=${page}`;
      const html = await this.fetchHtml(`${this.baseUrl}${path}`);
      const mangas = this.parseCards(html, 'article.popular-card');
      return { mangas, hasNextPage: this.hasNextPage(html) };
    }
    const html = await this.fetchHtml(`${this.baseUrl}/?page=${page}`);
    const mangas = this.parseCards(html, 'article.latest-card');
    return { mangas, hasNextPage: this.hasNextPage(html) };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const facts: Record<string, string> = {};
    $('div.series-facts dl > div').toArray().forEach(row => {
      const $row = $(row);
      const label = ($row.find('dt').first().text() || '').trim().toLowerCase();
      if (label) facts[label] = $row.find('dd').first().text().trim();
    });
    const h1 = $('section.profile-manga h1').first();
    const title = h1.clone().children().remove().end().text().trim() || h1.text().trim();
    const thumbnailUrl = this.absUrl($('div.series-cover-frame img').first().attr('src') || '');
    const description = $('p.series-summary').first().text().trim() || undefined;
    const genreText = (() => {
      const dd = $('div.series-facts dl > div').toArray()
        .map(row => $(row))
        .find($row => ($row.find('dt').first().text() || '').trim().toLowerCase().includes('genre'));
      return dd?.find('a').toArray().map(a => $(a).text().trim()).filter(Boolean).join(', ') || undefined;
    })();
    const statusText = facts['status'] || '';
    const status = /ongoing/i.test(statusText) ? 1 : /completed/i.test(statusText) ? 0 : undefined;
    const author = facts['author(s)'] || facts['author'] || undefined;
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, author, description, genre: genreText, status };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    let next: string | null = mangaUrl;
    while (next) {
      const res = await this.get(next);
      const $ = this.$(res.data);
      $('a.release-row').toArray().forEach(node => {
        const $a = $(node);
        const name = $a.find('strong').first().text().trim() || $a.text().trim();
        const url = this.absUrl($a.attr('href') || '');
        if (url) chapters.push({ name, url });
      });
      const nextHref = $('nav.pagination a[aria-label="Next page"]').first().attr('href');
      next = nextHref ? this.absUrl(nextHref) : null;
      if (chapters.length > 2000) break;
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.reader-pages figure.reader-page-image img').toArray().map((node, index) => {
      const $img = $(node);
      const src = $img.attr('src') || $img.attr('data-src') || '';
      return { index, imageUrl: this.absUrl(src) };
    });
  }
}
