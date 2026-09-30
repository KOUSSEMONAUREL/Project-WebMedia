import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `fr/lelscan` (Lelscan.kt).
 *
 * Single-host scan archive: one reader page per series (`/lecture-en-ligne-*`),
 * each listing its chapters as `/scan-<slug>/<n>` links.
 *
 * Two deliberate divergences from upstream, both because the site changed:
 *
 * 1. The catalogue is the **second** `<select>`, not the first. The first is a
 *    global chapter navigator that only One Piece populates (517 entries);
 *    upstream reads the first as the catalogue, which yields episode numbers
 *    instead of series. The second holds the 34 real series. The selector is
 *    global (`select`) rather than `#navigation select` because the page's
 *    unclosed tags make cheerio place both selects outside that div, so the
 *    scoped selector matches nothing.
 * 2. Chapters come from the `a[href*="/scan-"]` links on the series page, not
 *    from a second `<select>`: that select is empty on every series except
 *    One Piece.
 *
 * Search is client-side, as upstream: the site has no search endpoint.
 */

const CATALOG_PATH = '/lecture-en-ligne-one-piece';

export class LelscanScraper extends BaseScraper {
  readonly name = 'Lelscan';
  readonly baseUrl = 'https://lelscans.net';
  readonly lang = 'fr';

  async getPopular(page: number = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const res = await this.get(`${this.baseUrl}${CATALOG_PATH}`);
    return { mangas: this.catalogMangas(res.data), hasNextPage: false };
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const term = query.trim();
    const all = await this.getPopular(1);
    if (!term) return all;
    return {
      mangas: all.mangas.filter(m => m.title.toLowerCase().includes(term.toLowerCase())),
      hasNextPage: false,
    };
  }

  private catalogMangas(html: string): Manga[] {
    const $ = this.$(html);
    // Second <select>: see the file header. `#navigation select` matches
    // nothing because of how cheerio reparses the unclosed tags.
    const $select = $('select').eq(1);
    const mangas: Manga[] = [];
    $select.find('option').each((_i, el) => {
      const $el = $(el);
      const href = $el.attr('value');
      const title = $el.text().trim();
      if (!href || !title) return;
      mangas.push({
        title,
        url: this.stripDomain(href),
        thumbnailUrl: this.thumbnailFromPath(href),
        lang: this.lang,
      });
    });
    return mangas;
  }

  /** Covers live at /mangas/<slug>/thumb_cover.jpg, where <slug> is the reader
   page slug with its "lecture-en-ligne-" / "lecture-ligne-" prefix stripped. */
  private thumbnailFromPath(href: string): string {
    try {
      const url = new URL(href, this.baseUrl);
      const page = url.pathname.replace(/\.php$/, '').split('/').filter(Boolean).pop() ?? '';
      const slug = page.replace(/^lecture-(?:en-)?ligne-/, '');
      return slug ? `${this.baseUrl}/mangas/${slug}/thumb_cover.jpg` : '';
    } catch {
      return '';
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    // "#header-image h2 div" index 1 holds "Lecture en ligne {Title}".
    const breadcrumb = $('#header-image h2 div').eq(1).find('span[itemprop="title"]').first().text();
    const title = breadcrumb.replace('Lecture en ligne ', '').trim();
    const og = $('meta[property="og:image"]').attr('content');
    return {
      title,
      url: this.stripDomain(mangaUrl),
      thumbnailUrl: og ? this.absUrl(og) : '',
      status: undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    // The series page slug ("lecture-en-ligne-beelzebub.php") does not match
    // the scan path prefix ("/scan-beelzebub/"), so the prefix is calibrated
    // from the first chapter link on the page instead of derived from the URL.
    const pattern = /\/scan-[^/]+\/([0-9][0-9.]*)(?:\/(\d+))?$/;
    const candidates: { href: string; prefix: string; number: string }[] = [];
    $('a[href*="/scan-"]').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const match = pattern.exec(href);
      // Skip the "/1", "/2" ... page links of an already-listed chapter.
      if (!match || match[2]) return;
      const prefix = href.slice(0, href.length - match[1].length);
      candidates.push({ href, prefix, number: match[1] });
    });
    if (candidates.length === 0) return [];
    const prefix = candidates[0].prefix;
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    for (const item of candidates) {
      if (item.prefix !== prefix || seen.has(item.href)) continue;
      seen.add(item.href);
      chapters.push({
        name: `Chapitre ${item.number}`,
        url: this.stripDomain(item.href),
        chapterNumber: this.toChapterNumber(item.number),
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    // Page 1 holds the first batch; the reader paginates as /1, /2, ...
    const res = await this.get(`${this.absUrl(chapterUrl)}/1`);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('img[src]').each((index, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      // Skip the sidebar cover thumbnails that share the page.
      if (!/\/\d+\/\d+\.jpg/.test(src)) return;
      pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private stripDomain(href: string): string {
    try {
      const u = new URL(href, this.baseUrl);
      return u.pathname + u.search;
    } catch {
      return href;
    }
  }

  /** Faithful to upstream `toFloatOrNull() ?: -1f`. */
  private toChapterNumber(label: string): number {
    const trimmed = label.trim();
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return -1;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? -1 : parsed;
  }
}