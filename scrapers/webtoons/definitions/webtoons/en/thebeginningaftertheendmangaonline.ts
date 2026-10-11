import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/thebeginningaftertheendmangaonline`
 * (TheBeginningAfterTheEndMangaOnline.kt).
 *
 * Single-manga site: the catalogue IS the root page. `getPopular` returns the
 * one entry, `getSearch` matches it by title, details come from the `og:`
 * meta tags, and chapters are the `a[href*='beginning-after-the-end-']` links
 * deduplicated by chapter number (a `ch-N` slug wins over a `chapter-N`
 * duplicate because it carries the images).
 *
 * Pages are lazy-loaded (`data-src` / `data-lazy-src`, Blogger chapters) or
 * Kadence galleries (`data-src` / `srcset`); the `cropped-` assets are the
 * site logo, not pages — all mirrored from the Kt's `isPageImage`.
 *
 * Verified live 2026-10-11 (`curl -4`): `/` 200 with chapter links 252–256
 * and `og:image`/`og:description`; chapter page 200 with 83 imgs whose real
 * URLs sit in `data-*` attributes (`src` holds `data:` placeholders).
 */

const TITLE = 'The Beginning After The End';
const CHAPTER_NUMBER_REGEX = /(?:chapter|ch)-(\d+)\/?$/;
const CH_SLUG_REGEX = /\/ch-\d+\/?$/;

export class TheBeginningAfterTheEndMangaOnlineScraper extends BaseScraper {
  readonly name = 'Read The Beginning After The End Manga Online';
  readonly baseUrl = 'https://w22.thebeginningaftertheendmanga.com';
  readonly lang = 'en';

  private singleManga(thumbnailUrl = ''): Manga {
    return { title: TITLE, url: '/', thumbnailUrl, lang: this.lang };
  }

  async getPopular(): Promise<SearchResult> {
    return { mangas: [this.singleManga()], hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const manga = this.singleManga();
    return {
      mangas: TITLE.toLowerCase().includes(query.trim().toLowerCase()) ? [manga] : [],
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get('/');
    const $ = this.$(res.data as string);
    return {
      title: TITLE,
      url: mangaUrl,
      thumbnailUrl: this.absUrl($("meta[property='og:image']").attr('content') || ''),
      description: ($("meta[property='og:description']").attr('content') || '').trim() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get('/');
    const $ = this.$(res.data as string);
    const byNumber = new Map<string, string>();
    $("a[href*='beginning-after-the-end-']").each((_i, element) => {
      const href = $(element).attr('href') || '';
      const match = CHAPTER_NUMBER_REGEX.exec(href);
      if (!match) return;
      const num = match[1];
      const existing = byNumber.get(num);
      if (existing === undefined || (CH_SLUG_REGEX.test(href) && !CH_SLUG_REGEX.test(existing))) {
        byNumber.set(num, href);
      }
    });
    return [...byNumber.entries()]
      .map(([num, href]) => ({
        name: `Chapter ${num}`,
        url: href.startsWith('http') ? href : this.absUrl(href),
        chapterNumber: Number.parseFloat(num),
      }))
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  private isPageImage(url: string): boolean {
    if (!url.startsWith('http')) return false;
    if (url.includes('cropped-')) return false;
    return url.includes('blogger.googleusercontent.com')
      || url.includes('bp.blogspot.com')
      || url.includes('img.thebeginningaftertheendmanga.com');
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const urls: string[] = [];
    $('.entry-content img').each((_i, element) => {
      const $img = $(element);
      const url = ($img.attr('data-src') || '').trim()
        || ($img.attr('data-lazy-src') || '').trim()
        || ($img.attr('srcset') || '').split(',')[0]?.split(' ')[0]?.trim()
        || ($img.attr('src') || '').trim();
      if (url && this.isPageImage(this.absUrl(url)) && !urls.includes(this.absUrl(url))) {
        urls.push(this.absUrl(url));
      }
    });
    return urls.map((imageUrl, index) => ({ index, imageUrl }));
  }
}

export default TheBeginningAfterTheEndMangaOnlineScraper;
