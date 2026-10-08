import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/hentaifc` (HentaiFC.kt).
 *
 * The site only publishes a "Latest Updates" listing, served here via
 * getPopular. getSearch is a single-shot query (page 1 only). Chapters are
 * derived from the gallery page's thumbnail grid because the reader page
 * itself is JS-rendered.
 */

const RELATIVE_DATE_RE = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/;

function parseRelativeDate(text: string | undefined): number | undefined {
  const match = text?.match(RELATIVE_DATE_RE);
  if (!match) return undefined;
  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const ms =
    unit === 'second' ? amount * 1_000 :
    unit === 'minute' ? amount * 60_000 :
    unit === 'hour' ? amount * 3_600_000 :
    unit === 'day' ? amount * 86_400_000 :
    unit === 'week' ? amount * 604_800_000 :
    unit === 'month' ? amount * 2_592_000_000 :
    amount * 31_536_000_000;
  return Date.now() - ms;
}

export class HentaiFCScraper extends BaseScraper {
  readonly name = 'HentaiFC';
  readonly baseUrl = 'https://hentaifc.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = page === 1 ? this.baseUrl : `${this.baseUrl}/page/${page}`;
    const res = await this.get(url);
    const $ = this.$(String(res.data));
    const mangas: Manga[] = [];
    $('#book_list .wrap_item').each((_i, el) => {
      const m = this.parseEntry($, el);
      if (m) mangas.push(m);
    });
    const hasNextPage = $('a.next.page-numbers').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (page > 1 || query.trim().length === 0) return { mangas: [], hasNextPage: false };
    const url = `${this.baseUrl}/?search=${encodeURIComponent(query)}&search_by=title`;
    const res = await this.get(url);
    const $ = this.$(String(res.data));
    const mangas: Manga[] = [];
    $('#book_list .wrap_item').each((_i, el) => {
      const m = this.parseEntry($, el);
      if (m) mangas.push(m);
    });
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(String(res.data));
    const title = $('h1.heading').first().text().trim();
    if (!title) throw new Error(`Empty title for ${mangaUrl}`);
    const author = $('.d-cell.value.authors a.author')
      .map((_i, el) => $(el).text()).get().join(', ') || undefined;
    const genre = $('.genres a[href*=/tag/]')
      .map((_i, el) => $(el).text()).get().join(', ') || undefined;
    const thumb = $('.thumbs .wrap_item img').first();
    const thumbnailUrl = thumb.length
      ? (thumb.attr('data-src') || thumb.attr('src') || '') || undefined
      : undefined;
    return {
      title,
      url: this.relativize(this.absUrl(mangaUrl)),
      thumbnailUrl: thumbnailUrl ?? '',
      author,
      artist: author,
      genre,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(String(res.data));
    const galleryUrl = this.absUrl(mangaUrl).replace(/\/+$/, '');
    const galleryId = galleryUrl.substring(galleryUrl.lastIndexOf('/') + 1);
    const dateUpload = parseRelativeDate($('.d-cell.value.updateAt').first().text());
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    $('.thumbs .wrap_item a[href]').each((_i, el) => {
      const href = $(el).attr('abs:href') || this.absTo($(el).attr('href') ?? '');
      if (!new RegExp(`/e/${galleryId}/c\\d+`).test(href)) return;
      const clean = href.split('#')[0].split('?')[0];
      if (seen.has(clean)) return;
      seen.add(clean);
      const m = clean.match(/\/c(\d+(?:\.\d+)?)$/);
      if (!m) return;
      const number = parseFloat(m[1]);
      if (Number.isNaN(number)) return;
      chapters.push({
        name: `Chapter ${Math.trunc(number)}`,
        url: this.pathOnly(clean),
        chapterNumber: number,
        dateUpload,
      });
    });
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const fullUrl = this.absUrl(chapterUrl);
    const chapterSeg = fullUrl.match(/\/c(\d+(?:\.\d+)?)/);
    const chapterNumber = chapterSeg ? chapterSeg[1] : '';
    const galleryUrl = fullUrl.replace(/\/c\d+(?:\.\d+)?.*$/, '');
    const res = await this.get(galleryUrl);
    const $ = this.$(String(res.data));
    const pages: Page[] = [];
    $('.thumbs .wrap_item').each((_i, el) => {
      const href = $(el).find('a[href]').first().attr('href') ?? '';
      const abs = this.absTo(href).split('#')[0].split('?')[0];
      const m = abs.match(/\/c(\d+(?:\.\d+)?)$/);
      if (!m || m[1] !== chapterNumber) return;
      const img = $(el).find('img').first();
      const imageUrl = img.attr('data-src') || img.attr('src') || '';
      if (!imageUrl) return;
      pages.push({ index: pages.length, imageUrl });
    });
    return pages;
  }

  private parseEntry($: ReturnType<BaseScraper['$']>, el: unknown): Manga | null {
    const $el = $(el as never);
    const $link = $el.find('h3.title a').first();
    const link = $link.attr('href') ?? '';
    if (!link) return null;
    const title = $link.text().trim();
    if (!title) return null;
    const abs = this.absTo(link);
    let url = abs;
    try {
      url = new URL(abs).pathname;
    } catch {
      // keep abs
    }
    const img = $el.find('.wrap_img img').first();
    const thumbnailUrl = img.attr('src') || '';
    const genre = $el.find('.genres a').map((_i, a) => $(a).text()).get().join(', ') || undefined;
    return { title, url, thumbnailUrl, genre, lang: this.lang };
  }

  private absTo(href: string): string {
    try {
      return new URL(href, this.baseUrl).toString();
    } catch {
      return href;
    }
  }

  private pathOnly(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url.startsWith('/') ? url : '/' + url;
    }
  }

  private relativize(url: string): string {
    return url.startsWith(this.baseUrl) ? url.slice(this.baseUrl.length) : url;
  }
}
