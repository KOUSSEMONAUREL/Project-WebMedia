import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `all/baobua` (BaoBua.kt + Filters.kt).
 *
 * Cosplay gallery source at `https://baobua.net`. Popular is `/?page=N`,
 * text search is `/search?q=<query>&page=N`. Upstream also exposes a
 * category filter (`/category/<cat>?page=N`: Ao-yem, Asia, Beauty, Bikini,
 * China, Cosplay, Japan, Nude, Sexy, Top, Tattoo, Vietnam); this scraper
 * keeps the text-search/popular behaviour and documents the categories here
 * instead of a filter DSL. Each gallery is a single "Gallery" chapter whose
 * images (`div.contentme a[href^=/img.html] img`) may span several `Next`
 * pages. Upstream rate-limits to 3 req/s; requests here stay sequential.
 */

export class BaobuaScraper extends BaseScraper {
  readonly name = 'BaoBua';
  readonly baseUrl = 'https://baobua.net';
  readonly lang = 'all';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?page=${page}`);
    return this.parseMangaList(res.data as string);
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error('getLatest is not supported by BaoBua');
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    const params = new URLSearchParams({ q: term, page: String(page) });
    const res = await this.get(`${this.baseUrl}/search?${params.toString()}`);
    return this.parseMangaList(res.data as string);
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.thcovering-video').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('a.denomination').first();
      const href = $link.attr('href');
      if (!href) return;
      const img = $el.find('img.xld').first().attr('src');
      mangas.push({
        title: $link.text().trim(),
        url: this.toPath(href),
        thumbnailUrl: img ? this.normalizeImageUrl(this.absUrl(img)) : '',
        lang: this.lang,
        status: 0,
      });
    });
    return { mangas, hasNextPage: $('a.page-numbers.next').length > 0 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const genre = $('.it-categories a')
      .toArray()
      .map(a => $(a).text().trim())
      .filter(Boolean)
      .join(', ');
    return {
      url: this.stripDomain(mangaUrl),
      lang: this.lang,
      genre: genre || undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const canonical = $('link[rel="canonical"]').first().attr('href');
    const url = canonical ? this.toPath(canonical) : this.stripDomain(mangaUrl);
    const dateMatch = /"datePublished":"([^"]+)"/.exec(res.data as string);
    const time = dateMatch?.[1] ? Date.parse(dateMatch[1]) : NaN;
    return [
      {
        name: 'Gallery',
        url,
        chapterNumber: 0,
        ...(Number.isNaN(time) ? {} : { dateUpload: time }),
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const pages: Page[] = [];
    let html: string | undefined;
    let nextUrl: string | undefined = this.absUrl(chapterUrl);
    const seen = new Set<string>();
    while (nextUrl && !seen.has(nextUrl)) {
      seen.add(nextUrl);
      const res = await this.get(nextUrl);
      html = res.data as string;
      const $ = this.$(html);
      $('div.contentme a[href^="/img.html"] img').each((_, el) => {
        const src = $(el).attr('src');
        if (!src) return;
        pages.push({ index: pages.length, imageUrl: this.normalizeImageUrl(this.absUrl(src)) });
      });
      const nextHref = $('a.page-numbers:contains("Next")').first().attr('href');
      nextUrl = nextHref ? this.absUrl(nextHref) : undefined;
    }
    return pages;
  }

  private normalizeImageUrl(url: string): string {
    if (/^https:\/\/i\d+\.wp\.com\//.test(url)) {
      return url.replace(/^https:\/\/i\d+\.wp\.com\//, 'https://').replace('?w=640', '');
    }
    return url;
  }

  private toPath(href: string): string {
    try {
      return new URL(href, this.baseUrl).pathname;
    } catch {
      return href;
    }
  }

  private stripDomain(href: string): string {
    try {
      const u = new URL(href, this.baseUrl);
      return u.pathname + u.search;
    } catch {
      return href;
    }
  }
}
