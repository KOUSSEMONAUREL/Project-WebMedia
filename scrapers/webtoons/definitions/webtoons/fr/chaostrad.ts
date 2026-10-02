import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `fr/chaostrad` (ChaosTrad.kt).
 *
 * No search endpoint upstream: the catalogue is the comics navigation menu on
 * `https://chaostrad.fr` (links under `#comics-main`'s sibling). `/comics/*`
 * links are series, `/search/*` links are collections followed to discover
 * their `a.comic-link` series (or the redirect target when they resolve to a
 * single series). Search filters that in-memory catalogue. Series pages list
 * `a.comic-link` chapters; single-chapter series expose no chapter cards and
 * yield one `#N` chapter. Pages are `img.comic-image`.
 */

export class ChaostradScraper extends BaseScraper {
  readonly name = 'ChaosTrad';
  readonly baseUrl = 'https://chaostrad.fr';
  readonly lang = 'fr';

  async getPopular(page: number = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    return { mangas: await this.parseCatalog(), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error('getLatest is not supported by ChaosTrad');
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const term = query.trim().toLowerCase();
    const all = await this.parseCatalog();
    if (!term) return { mangas: all, hasNextPage: false };
    return { mangas: all.filter(m => m.title.toLowerCase().includes(term)), hasNextPage: false };
  }

  private async parseCatalog(): Promise<Manga[]> {
    const mangas: Manga[] = [];
    const added = new Set<string>();
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data as string);
    const submenu = $('#comics-main').first().next();
    const links = submenu.find('a[href]').toArray();
    for (const link of links) {
      const href = ($(link).attr('href') ?? '').trim();
      const title = this.normalizeSeriesTitle(($(link).attr('title') ?? '').trim());
      if (href.startsWith('/comics/')) {
        if (!added.has(href)) {
          added.add(href);
          mangas.push({ title, url: href, thumbnailUrl: '', lang: this.lang });
        }
      } else if (href.startsWith('/search/')) {
        await this.collectCollection(href, title, mangas, added);
      }
    }
    return mangas;
  }

  private async collectCollection(
    href: string,
    fallbackTitle: string,
    mangas: Manga[],
    added: Set<string>,
  ): Promise<void> {
    const sub = await this.get(`${this.baseUrl}${href}`);
    const finalPath = this.responsePath(sub, href);
    const $sub = this.$(sub.data as string);
    if (finalPath.startsWith('/search/')) {
      $sub('a.comic-link[href]').each((_i, el) => {
        const colHref = this.absUrl($sub(el).attr('href') ?? '').replace(this.baseUrl, '');
        let seriesPath: string | undefined;
        if (colHref.startsWith('/comics/')) {
          const slug = colHref.split('/')[2];
          if (!slug) return;
          seriesPath = `/comics/${slug}`;
        } else if (colHref.startsWith('/search/')) {
          seriesPath = colHref;
        } else {
          return;
        }
        if (added.has(seriesPath)) return;
        added.add(seriesPath);
        mangas.push({
          title: this.normalizeSeriesTitle(($sub(el).attr('title') ?? '').trim()),
          url: seriesPath,
          thumbnailUrl: '',
          lang: this.lang,
        });
      });
    } else {
      const parts = finalPath.split('/');
      const seriesPath = parts.length >= 4 && parts[1] === 'comics' ? `/comics/${parts[2]}` : finalPath;
      if (added.has(seriesPath)) return;
      added.add(seriesPath);
      const h1 = $sub('h1').first().text().trim();
      const head = $sub('title').first().text().trim();
      const resolved = this.normalizeSeriesTitle(h1 || head) || fallbackTitle;
      mangas.push({ title: resolved, url: seriesPath, thumbnailUrl: '', lang: this.lang });
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const path = mangaUrl.split('?')[0] ?? mangaUrl;
    const res = await this.get(`${this.baseUrl}${path}`);
    const $ = this.$(res.data as string);
    const title = this.normalizeSeriesTitle(
      ($('h1').first().text().trim() || $('title').first().text().trim()),
    );
    const thumbnailUrl =
      $('a.comic-link img[src*="_thumbnail"]').first().attr('src') ??
      $('img.comic-image').first().attr('src') ??
      '';
    return {
      title: title || undefined,
      url: path,
      thumbnailUrl: thumbnailUrl ? this.absUrl(thumbnailUrl) : '',
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const path = mangaUrl.split('?')[0] ?? mangaUrl;
    const res = await this.get(`${this.baseUrl}${path}`);
    const finalPath = this.responsePath(res, path);
    const $ = this.$(res.data as string);
    const cards = $('a.comic-link').toArray();
    if (cards.length === 0) {
      const num = Number(finalPath.split('/').filter(Boolean).pop());
      const chapterNumber = Number.isNaN(num) ? 1 : num;
      return [{ name: this.formatChapterName(chapterNumber), url: finalPath, chapterNumber }];
    }
    const chapters: Chapter[] = cards.map(el => {
      const href = ($(el).attr('href') ?? '').trim();
      const raw = href.split('/').filter(Boolean).pop() ?? '';
      const parsed = Number(raw);
      const chapterNumber = raw !== '' && !Number.isNaN(parsed) ? parsed : -1;
      const dateText = $(el).find('p.release-date').first().text().trim();
      const dateUpload = this.parseFrDate(dateText);
      return {
        name: this.formatChapterName(chapterNumber),
        url: href,
        chapterNumber,
        ...(dateUpload !== undefined ? { dateUpload } : {}),
      };
    });
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${this.baseUrl}${chapterUrl}`);
    const $ = this.$(res.data as string);
    const pages: Page[] = [];
    $('img.comic-image').each((index, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private normalizeSeriesTitle(raw: string): string {
    const stripped = raw
      .replace(/^Chapitre de /, '')
      .replace(/^Voir le chapitre /, '')
      .trim();
    const idx = stripped.lastIndexOf(' #');
    return (idx >= 0 ? stripped.slice(0, idx) : stripped).trim();
  }

  private formatChapterName(n: number): string {
    if (n >= 0 && Number.isInteger(n)) return `#${n}`;
    if (n >= 0) return `#${n}`;
    return '#?';
  }

  private parseFrDate(raw: string): number | undefined {
    // Upstream pattern "d.M.yyyy" (e.g. "5.03.2024").
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(raw.trim());
    if (!m) return undefined;
    const time = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(time) ? undefined : time;
  }

  private responsePath(res: { request?: unknown }, fallback: string): string {
    try {
      const req = res.request as {
        responseURL?: string;
        res?: { responseUrl?: string };
      };
      const finalUrl = req?.responseURL ?? req?.res?.responseUrl;
      if (finalUrl) return new URL(finalUrl).pathname;
    } catch {
      // fall through
    }
    return fallback;
  }
}
