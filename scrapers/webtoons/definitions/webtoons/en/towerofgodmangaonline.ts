import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/towerofgodmangaonline`
 * (TowerOfGodMangaOnline.kt, `MangaCatalog` theme).
 *
 * Single-manga site: the catalogue IS the root page. `getPopular` returns the
 * one entry, `getSearch` matches it by title, details come from the `og:`
 * meta tags, chapters are the `a[href*='/manga/tower-of-god-chapter-']` links,
 * and pages are the Blogger images (`img[src*='blogger…']`,
 * `img[src*='bp.blogspot…']`) — transcribed verbatim from the Kt's
 * `pageListParse`, `src` attribute included.
 *
 * The engine's `MangaCatalogScraper` is deliberately NOT reused: its
 * selectors target the generic catalog-theme layout (`div.container > h1`,
 * `div.bg-bg-secondary`), while this site is a WordPress install.
 *
 * Verified live 2026-10-11 (`curl -4`): `/` 200 ("Tower Of God Manga Online -
 * All Chapters", `og:image` on `w31.thetowerofgod.com`, chapter links
 * 649–653); chapter page 200. Note: chapter 653 currently serves only its
 * cover outside Blogger embeds, so `getPageList` may come back empty on some
 * chapters — without effect here, since the webtoon pipeline only ingests
 * the series URL.
 */

const TITLE = 'Tower of God';
const CHAPTER_NUMBER_REGEX = /chapter-(\d+)/;

export class TowerOfGodMangaOnlineScraper extends BaseScraper {
  readonly name = 'Tower Of God Manga Online';
  readonly baseUrl = 'https://w82.thetowerofgod.com';
  readonly lang = 'en';

  private singleManga(thumbnailUrl = ''): Manga {
    return { title: TITLE, url: this.baseUrl, thumbnailUrl, lang: this.lang };
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
    const res = await this.get(this.baseUrl);
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
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];
    $("a[href*='/manga/tower-of-god-chapter-']").each((_i, element) => {
      const href = $(element).attr('abs:href') || $(element).attr('href') || '';
      const match = CHAPTER_NUMBER_REGEX.exec(href);
      if (!match) return;
      const num = match[1];
      const url = href.startsWith('http') ? href : this.absUrl(href);
      if (chapters.some((c) => c.url === url)) return;
      chapters.push({ name: `Chapter ${num}`, url, chapterNumber: Number.parseFloat(num) });
    });
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const urls = $("img[src*='blogger.googleusercontent.com'], img[src*='bp.blogspot.com']").toArray()
      .map((el) => $(el).attr('abs:src') || $(el).attr('src') || '')
      .filter((src) => src.trim() !== '');
    return [...new Set(urls)].map((imageUrl, index) => ({ index, imageUrl }));
  }
}

export default TowerOfGodMangaOnlineScraper;
