import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio } from 'cheerio';

/**
 * Transcompilation of keiyoushi `en/mangadrama` (MangaDrama.kt).
 *
 * WordPress site using UIkit markup. Manga cards live in `div.manga-item-grid`,
 * details in `div.manga-info-details`, chapters in `div.chapter-list > div`.
 *
 * `getPageList` is deliberately empty: chapter bodies are served as
 * `var InitMangaEncryptedChapter = { "ciphertext": ... }`, which upstream
 * decrypts with the initmanga multisrc. This project is a link-out aggregator
 * -- no component downloads chapter page bytes (see README, "Fonctionnement du
 * site") -- so carrying a decryption routine that nothing consumes would be
 * dead weight. If a reader is ever built, that is where the decryption goes.
 */

const POPULAR_PATH = '/manga-ranking/';
const LATEST_PATH = '/recently-updated/';

export class MangaDramaScraper extends BaseScraper {
  readonly name = 'MangaDrama';
  readonly baseUrl = 'https://mangadrama.com';
  readonly lang = 'en';

  async getPopular(page: number = 1): Promise<SearchResult> {
  if (page > 1) return { mangas: [], hasNextPage: false };
  const res = await this.get(`${this.baseUrl}${POPULAR_PATH}`);
  return this.parseListing(res.data);
}

async getLatest(page: number = 1): Promise<SearchResult> {
  if (page > 1) return { mangas: [], hasNextPage: false };
  const res = await this.get(`${this.baseUrl}${LATEST_PATH}`);
  return this.parseListing(res.data);
}

async getSearch(query: string, page: number = 1): Promise<SearchResult> {
  const term = encodeURIComponent(query.trim());
  if (!term) return this.getPopular(page);
  // Native WordPress search. It returns `article` cards, not `manga-item-grid`
  // ones, and wraps the matched words in <mark>, so the parser strips those.
  if (page > 1) return { mangas: [], hasNextPage: false };
  const res = await this.get(`${this.baseUrl}/?s=${term}`);
  return this.parseSearchResults(res.data);
}

private parseListing(html: string): SearchResult {
  const $ = this.$(html);
  const mangas: Manga[] = [];
  $('.manga-item-grid').each((_i, el) => {
    const $el = $(el);
    const $title = $el.find('h2 a.uk-link-heading').first();
    const href = $title.attr('href') || $el.find('a[href*="/manga/"]').first().attr('href');
    if (!href) return;
    const title = $title.text().trim();
    if (!title) return;
    const ribbon = $el.find('.manga-status-ribbon').first().text().trim().toLowerCase();
    mangas.push({
      title,
      url: this.stripDomain(href),
      thumbnailUrl: this.imgAttr($el.find('a[href*="/manga/"] img').first()),
      lang: this.lang,
      status: ribbon.includes('ongoing') ? 1 : ribbon.includes('completed') ? 0 : undefined,
    });
  });
  // Both rankings dump every card on one page; there is no pagination.
  return { mangas, hasNextPage: false };
}

private parseSearchResults(html: string): SearchResult {
  const $ = this.$(html);
  const mangas: Manga[] = [];
  $('article').each((_i, el) => {
    const $el = $(el);
    const $title = $el.find('h2 a.uk-link-heading, h3 a.uk-link-heading').first();
    const href = $title.attr('href') || $el.find('a[href*="/manga/"]').first().attr('href');
    if (!href) return;
    // `mark` tags highlight the query; cheerio's .text() drops them already.
    const title = $title.text().trim();
    if (!title) return;
    mangas.push({
      title,
      url: this.stripDomain(href),
      thumbnailUrl: this.imgAttr($el.find('a[href*="/manga/"] img').first()),
      lang: this.lang,
    });
  });
  return { mangas, hasNextPage: false };
}

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    const title = $('h1').first().text().trim();
    const genre = $('#genre-tags a')
      .toArray()
      .map(a => $(a).text().trim())
      .filter(Boolean)
      .join(', ');
    const description = $('.uk-text-lead').first().text().trim();
    const illustrator = this.infoValue($, 'Illustrator');
    const author = this.infoValue($, 'Author');
    const ribbon = $('.manga-status-ribbon').first().text().trim().toLowerCase();
    return {
      title,
      url: this.stripDomain(mangaUrl),
      thumbnailUrl: this.imgAttr($('.uk-article img, .uk-panel img, meta[property="og:image"]').first()),
      description: description || undefined,
      author: author || undefined,
      artist: illustrator || undefined,
      genre: genre || undefined,
      status: ribbon.includes('ongoing') ? 1 : ribbon.includes('completed') ? 0 : undefined,
      lang: this.lang,
    };
  }

  private infoValue($: ReturnType<BaseScraper['$']>, label: string): string | undefined {
    // `div.manga-info-details` is a flat "Illustrator: <span>Name</span>" list.
    const $el = $('.manga-info-details').first();
    if (!$el.length) return undefined;
    const nodes = $el.contents().toArray();
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const text = $(nodes[i]).text().trim().replace(/:$/, '');
      if (text.toLowerCase() === label.toLowerCase()) {
        const value = $(nodes[i + 1]).text().trim();
        if (value) return value;
      }
    }
    return undefined;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.chapter-list > div').each((_i, el) => {
      const $el = $(el);
      const $a = $el.find('a[href*="/chapter-"]').first();
      const href = $a.attr('href');
      if (!href) return;
      const name = $a.find('.uk-flex-none').first().text().trim() || $a.text().trim();
      const dateText = $a.find('[uk-tooltip]').first().attr('uk-tooltip');
      const date = dateText?.split('title:')[1]?.split(';')[0]?.trim();
      chapters.push({
        name,
        url: this.stripDomain(href),
        chapterNumber: this.toChapterNumber(name),
        dateUpload: date ? Date.parse(date) : undefined,
      });
    });
    return chapters;
  }

  async getPageList(): Promise<Page[]> {
    // Chapter bodies are encrypted client-side; see the file header.
    return [];
  }

  /** WordPress lazy-loads covers via data attributes before the src fallback. */
  private imgAttr($el: Cheerio<any>): string {
    if (!$el || !$el.length) return '';
    return this.absUrl(
      ($el.attr('data-src') as string) ||
        ($el.attr('data-lazy-src') as string) ||
        ($el.attr('data-srcset') as string)?.split(' ')[0] ||
        ($el.attr('src') as string) ||
        '',
    );
  }

  private stripDomain(href: string): string {
    try {
      const u = new URL(href, this.baseUrl);
      return `${u.pathname}${u.search}`.replace(/\/$/, '/') || '/';
    } catch {
      return href;
    }
  }

  /** Chapters are labelled "Chapter 87.1"; non-numeric labels fall back to -1. */
  private toChapterNumber(name: string): number {
    const match = /(\d+(?:\.\d+)?)/.exec(name.replace(/,/g, ''));
    if (!match) return -1;
    const parsed = Number(match[1]);
    return Number.isNaN(parsed) ? -1 : parsed;
  }
}