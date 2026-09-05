import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HentaiTntScraper extends BaseScraper {
  readonly name = 'HentaiTnT';
  readonly baseUrl = 'https://hentaitnt.net';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = page > 1 ? `${this.baseUrl}/recommended/page/${page}` : `${this.baseUrl}/recommended`;
    const res = await this.get(url);
    return this.parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = page > 1 ? `${this.baseUrl}/latest-updates/page/${page}` : `${this.baseUrl}/latest-updates`;
    const res = await this.get(url);
    return this.parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    let url: string;
    if (trimmed) {
      const params = new URLSearchParams({ s: trimmed });
      if (page > 1) {
        url = `${this.baseUrl}/page/${page}?${params.toString()}`;
      } else {
        url = `${this.baseUrl}/?${params.toString()}`;
      }
    } else {
      // No query: genre filter not implemented, return recommended as fallback
      return this.getPopular(page);
    }
    const res = await this.get(url);
    return this.parseList(res.data);
  }

  private parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.comic-card a').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const title = ($el.attr('title') || $el.text().trim()).trim();
      const thumb = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
      if (title && href) {
        mangas.push({
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(thumb),
          lang: this.lang,
        });
      }
    });
    const hasNextPage = $('a[title=Next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1').first().text().trim() || $('title').text().trim() || '';
    const author = $('i[title=Artists] + span a').first().text().trim() || undefined;
    const description = $('#synopsisText').text().trim() || undefined;
    const genre = $('.genre-item').toArray().map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined;
    const statusText = $('span:has(i[title=Status])').text().toLowerCase();
    let status: Manga['status'];
    if (statusText.includes('completed')) status = 0;
    else if (statusText.includes('ongoing')) status = 1;
    else status = undefined;
    const thumbnailUrl = this.absUrl($('.detail-thumb img').attr('src') || $('img').first().attr('src') || '');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      author,
      description,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const detailRes = await this.get(mangaUrl);
    const $detail = this.$(detailRes.data);
    const mangaId = $detail('#post_manga_id').attr('value') || '';
    if (!mangaId) return [];

    const form = new URLSearchParams();
    form.set('action', 'baka_ajax');
    form.set('type', 'load_chapters_paginated');
    form.set('parent_id', mangaId);
    form.set('per_page', '10000');
    form.set('order', 'newest_first');

    const res = await this.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const htmlFragment: string = data?.data?.html || '';
    if (!htmlFragment) return [];
    const $ = this.$(htmlFragment);
    const chapters: Chapter[] = [];
    $('.comic-card').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') || '';
      const isVip = $el.find('.fa-crown').length > 0;
      const title = (isVip ? '🔒 ' : '') + (a.attr('title') || a.text().trim());
      if (href && title.trim()) {
        chapters.push({ name: title.trim(), url: this.absUrl(href) });
      }
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.page-image').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original-src') || '';
      if (src) pages.push({ index: i, imageUrl: this.absUrl(src) });
    });
    if (pages.length > 0) return pages;
    // Fallback: extract image URLs embedded in JS (cdn URLs)
    const html = res.data as string;
    const urlRegex = /https:\\\/\\\/[^"]+\.jpg/g;
    const matches = html.match(urlRegex);
    if (matches) {
      const decoded = matches.map(u => u.replace(/\\\//g, '/')).filter(u => u.includes('cdn') || u.includes('tymanga'));
      const unique = [...new Set(decoded)];
      return unique.map((u, i) => ({ index: i, imageUrl: u }));
    }
    // Last fallback: any img
    $('img').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src && src.includes('cdn')) pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
    });
    return pages;
  }
}
