import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

export class ManganowScraper extends BaseScraper {
  readonly name = 'MangaNow';
  readonly baseUrl = 'https://manganow.to';
  readonly lang = 'en';

  private searchMangaSelector = '.manga_list-sbs .manga-poster';
  private mangaDetailsSelector = '#ani_detail';

  private absImage(el: ReturnType<ReturnType<BaseScraper['$']>>): string {
    const src = el.attr('data-src') || el.attr('data-lazy-src') || el.attr('data-url') || el.attr('src') || '';
    return src ? this.absUrl(src.trim()) : '';
  }

  private mangaFromElement($el: ReturnType<ReturnType<BaseScraper['$']>>): Manga | null {
    const href = $el.attr('href') || '';
    if (!href) return null;
    const img = $el.find('img').first();
    const title = (img.attr('alt') || $el.text() || '').trim();
    if (!title) return null;
    const url = this.absUrl(href);
    const thumbnailUrl = this.absImage(img);
    return { title, url, thumbnailUrl, lang: this.lang };
  }

  private async searchParse(url: string): Promise<SearchResult> {
    const res = await this.get(url);
    const $ = this.$(res.data as string);
    const mangas = $(this.searchMangaSelector)
      .toArray()
      .map((el) => this.mangaFromElement($(el)))
      .filter((m): m is Manga => m !== null);
    const hasNextPage = $('ul.pagination > li.active + li').length > 0;
    return { mangas, hasNextPage };
  }

  override async getPopular(page = 1): Promise<SearchResult> {
    // Mangareader's getPopular uses filter with sort=most-viewed
    const url = `${this.baseUrl}/filter?sort=most-viewed&page=${page}`;
    return this.searchParse(url);
  }

  override async getLatest(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/filter?sort=latest-updated&page=${page}`;
    return this.searchParse(url);
  }

  override async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) return this.getPopular(page);
    const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(query)}&page=${page}`;
    return this.searchParse(url);
  }

  override async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const detail = $('#ani_detail');
    if (detail.length === 0) return { title: '', url: mangaUrl, lang: this.lang };
    const title = detail.find('.manga-name').first().text().trim() || $('h1').first().text().trim();
    const thumbnailUrl = this.absImage(detail.find('img').first());
    const genres = detail
      .find('.genres > a')
      .toArray()
      .map((el) => $(el).text().trim())
      .join(', ');
    const desc = detail.find('.description').first().text().trim();
    const altTitle = detail.find('.manga-name-or').first().text().trim();
    const description = altTitle && altTitle !== title ? `${desc}\n\nAlternative Title: ${altTitle}`.trim() : desc || undefined;

    let author: string | undefined;
    let status: string | undefined;
    detail.find('.anisc-info > .item').each((_, el) => {
      const head = $(el).find('.item-head').first().text().trim();
      if (head.startsWith('Authors')) {
        const authors = $(el)
          .find('a')
          .toArray()
          .map((a) => $(a).text().trim().replace(/,/g, ''))
          .join(', ');
        if (authors) author = authors;
      }
      if (head.startsWith('Status')) {
        status = $(el).find('.name').first().text().trim();
      }
    });

    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      description,
      author,
      lang: this.lang,
      status: status ? this.parseStatus(status) : undefined,
    };
  }

  private parseStatus(s: string): MangaStatus {
    const v = s.toLowerCase();
    if (['ongoing', 'publishing', 'releasing'].includes(v)) return 1;
    if (['completed', 'finished'].includes(v)) return 0;
    if (['on-hold', 'on_hiatus'].includes(v)) return 3;
    if (['canceled', 'discontinued'].includes(v)) return 2;
    return undefined;
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const items = $('#en-chapters > li.chapter-item');
    if (items.length === 0) {
      // fallback: any chapter-item
      const fallback = $('li.chapter-item').toArray().map((el) => this.chapterFromEl($(el))).filter((c) => c.url);
      return fallback;
    }
    return items.toArray().map((el) => this.chapterFromEl($(el))).filter((c) => c.url);
  }

  private chapterFromEl($el: ReturnType<ReturnType<BaseScraper['$']>>): Chapter {
    const a = $el.find('a').first();
    const href = a.attr('href') || '';
    const dataId = $el.attr('data-id') || '';
    const url = href ? `${this.absUrl(href)}#${dataId}` : '';
    const name = a.find('.name').first().text().trim() || a.text().trim();
    return { name, url };
  }

  override async getPageList(chapterUrl: string): Promise<Page[]> {
    const rawUrl = chapterUrl.split('#')[0] || chapterUrl;
    const fragId = chapterUrl.split('#')[1] || '';
    let chapterId = fragId;
    if (!chapterId) {
      const res = await this.get(rawUrl);
      const $ = this.$(res.data as string);
      chapterId = $('div[data-reading-id]').first().attr('data-reading-id') || '';
      if (!chapterId) throw new Error('Unable to retrieve chapter id');
    }
    const ajaxUrl = `${this.baseUrl}/ajax/image/list/${chapterId}?mode=vertical`;
    const headers = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: encodeURI(rawUrl),
      'X-Requested-With': 'XMLHttpRequest',
    };
    const res = await this.get(ajaxUrl, { headers });
    const data = typeof res.data === 'string' ? JSON.parse(res.data as string) : (res.data as Record<string, unknown>);
    const html = (data['html'] as string) || '';
    const $ = this.$(html);
    const selector = '.container-reader-chapter > .iv-card:not([data-url$=manganow.jpg])';
    const cards = $(selector).length > 0 ? $(selector) : $('.container-reader-chapter .iv-card');
    const pages: Page[] = [];
    cards.each((idx, el) => {
      const url = ($(el).attr('data-url') || '').trim();
      if (!url || url.endsWith('manganow.jpg')) return;
      pages.push({ index: pages.length, imageUrl: url.trim() });
    });
    // also handle img fallback
    if (pages.length === 0) {
      $('.container-reader-chapter img').each((idx, el) => {
        const src = $(el).attr('data-src') || $(el).attr('src') || $(el).attr('data-url') || '';
        if (src) pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
      });
    }
    // ensure indices sequential
    return pages.map((p, i) => ({ index: i, imageUrl: p.imageUrl }));
  }
}
