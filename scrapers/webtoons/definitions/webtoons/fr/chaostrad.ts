import { BaseScraper } from '../../../engine/base';
import type { CheerioAPI } from 'cheerio';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `fr/chaostrad` (ChaosTrad.kt, baseUrl
 * https://chaostrad.fr). Site de scan FR WordPress.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - `supportsLatest = false` / `getLatestUpdates` jette → `getLatest` n'est
 *   pas surchargé (le moteur lève par défaut).
 * - Le Kt fait tout dans `fetchMangaUpdate` (manga + chapitres en une seule
 *   requête). Le moteur sépare `getMangaDetails` et `getChapterList` : chacun
 *   refait un GET de la série (logique `finalPath` dupliquée).
 * - `getImageUrl` absent du moteur : `getPageList` résout tout eager (logic
 *   identique, sans pass lazy).
 * - Les chapitres non numérotés (name "#?") gardent `chapterNumber = -1`.
 * - `date_upload` (format "d.M.yyyy") introuvable → `undefined` (0 en Kt).
 */

const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

export class ChaosTradScraper extends BaseScraper {
  readonly name = 'ChaosTrad';
  readonly baseUrl = 'https://chaostrad.fr';
  readonly lang = 'fr';

  private normalizeSeriesTitle(rawTitle: string): string {
    return rawTitle
      .replace(/^Chapitre de /, '')
      .replace(/^Voir le chapitre /, '')
      .split(' #')[0]
      .trim();
  }

  private formatChapterName(chapterNumber: number): string {
    if (chapterNumber >= 0 && chapterNumber % 1 === 0) {
      return `#${chapterNumber.toFixed(0)}`;
    }
    if (chapterNumber >= 0) {
      return `#${chapterNumber}`;
    }
    return '#?';
  }

  private parseDate(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const match = DATE_RE.exec(text.trim());
    if (!match) return undefined;
    const day = Number.parseInt(match[1] as string, 10);
    const month = Number.parseInt(match[2] as string, 10);
    const year = Number.parseInt(match[3] as string, 10);
    const ms = new Date(Date.UTC(year, month - 1, day)).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }

  private relativize(pathOrUrl: string): string {
    if (pathOrUrl.startsWith(this.baseUrl)) {
      return pathOrUrl.slice(this.baseUrl.length);
    }
    return pathOrUrl;
  }

  private finalRequestUrl(res: unknown, fallback: string): string {
    const url = (res as { request?: { responseURL?: string } }).request?.responseURL;
    return url && url.length > 0 ? url : fallback;
  }

  private encodedPathOf(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private seriesTitleOf($: ReturnType<typeof this.$>): string {
    return (
      $('h1').first().text().trim() ||
      $('title').first().text()
    ).trim();
  }

  /**
   * Série unitaire (page de lecture) ou multi-chapitres : extrait le numéro
   * depuis le dernier segment de l'URL, pour le portait des chapitres.
   */
  private chapterNumFromPath(path: string): number {
    const segment = path.split('/').filter(Boolean).pop() ?? '';
    const n = Number.parseFloat(segment);
    return Number.isNaN(n) ? -1 : n;
  }

  private mangaFromLink(
    title: string,
    href: string,
  ): Manga {
    return {
      title: this.normalizeSeriesTitle(title),
      url: this.relativize(this.absUrl(href)),
      thumbnailUrl: '',
      lang: this.lang,
    };
  }

/**
   * Promoue une entrée de sous-menu en série. `/comics/...` direct ; les
   * liens `/search/...` sont suivis (collection ou série unique), comme le
   * `when` du Kt.
   */
  private async collectFromMenu(
    href: string,
    title: string,
    mangas: Manga[],
    addedUrls: Set<string>,
  ): Promise<void> {
    if (href.startsWith('/comics/')) {
      if (addedUrls.has(href)) return;
      addedUrls.add(href);
      mangas.push(this.mangaFromLink(title, href));
      return;
    }

    if (!href.startsWith('/search/')) return;

    const res = await this.get(href);
    const finalPath = this.encodedPathOf(this.absUrl(this.finalRequestUrl(res, href)));
    const finalBase = this.relativize(finalPath);
    const $ = this.$(res.data);

    if (finalBase.startsWith('/search/')) {
      // Vraie page de collection : chaque a.comic-link mène à une série
      $('a.comic-link[href]').each((_i, el) => {
        const $link = $(el);
        const colHref = $link.attr('href')?.trim() ?? '';
        if (!colHref) return;
        let seriesPath: string | null = null;
        if (colHref.startsWith('/comics/')) {
          const slug = colHref.split('/')[2];
          if (!slug) return;
          seriesPath = `/comics/${slug}`;
        } else if (colHref.startsWith('/search/')) {
          seriesPath = colHref;
        } else {
          return;
        }
        if (addedUrls.has(seriesPath)) return;
        addedUrls.add(seriesPath);
        mangas.push(this.mangaFromLink($link.attr('title') ?? '', seriesPath));
      });
      return;
    }

    // Série unique (redirection depuis /search/...)
    const parts = finalBase.split('/');
    const seriesPath = parts.length >= 4 && parts[1] === 'comics'
      ? `/comics/${parts[2]}`
      : finalBase;
    if (addedUrls.has(seriesPath)) return;
    addedUrls.add(seriesPath);
    mangas.push(
      this.mangaFromLink(
        this.seriesTitleOf($) || title,
        seriesPath,
      ),
    );
  }

  /**
   * Construit la liste des séries via le menu de navigation. Collection
   * links (`/search/...`) suivis pour découvrir leurs séries (Kt
   * `parseCatalog()`).
   */
  private async parseCatalog(): Promise<Manga[]> {
    const mangas: Manga[] = [];
    const addedUrls = new Set<string>();

    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const submenu = $('#comics-main').first().next();

    const links: Array<{ href: string; title: string }> = [];
    submenu.find('a[href]').each((_i, el) => {
      const $link = $(el);
      const href = $link.attr('href')?.trim() ?? '';
      const title = $link.attr('title') ?? '';
      if (href) links.push({ href, title });
    });

    for (const link of links) {
      await this.collectFromMenu(link.href, link.title, mangas, addedUrls);
    }

    return mangas;
  }

  async getPopular(_page: number = 1): Promise<SearchResult> {
    const mangas = await this.parseCatalog();
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, _page: number = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    const mangas = await this.parseCatalog();
    const results = trimmed.length > 0
      ? mangas.filter((m) => m.title.toLowerCase().includes(trimmed.toLowerCase()))
      : mangas;
    return { mangas: results, hasNextPage: false };
  }

  /** Fetch la page du manga, résout l'URL finale et retourne $ + finalPath */
  private async fetchSeriesPage(
    mangaUrl: string,
  ): Promise<{ $: CheerioAPI; finalPath: string }> {
    const res = await this.get(mangaUrl);
    const finalPath = this.encodedPathOf(this.absUrl(this.finalRequestUrl(res, mangaUrl)));
    return { $: this.$(res.data), finalPath };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const { $, finalPath } = await this.fetchSeriesPage(mangaUrl);
    const manga: Partial<Manga> = {
      title: this.seriesTitleOf($) || undefined,
      url: this.relativize(finalPath),
      lang: this.lang,
    };

    const thumbnail = $('a.comic-link img[src*="_thumbnail"]').first().attr('src')
      ?? $('img.comic-image').first().attr('src');
    if (thumbnail) manga.thumbnailUrl = this.absUrl(thumbnail);

    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const { $, finalPath } = await this.fetchSeriesPage(mangaUrl);
    const $links = $('a.comic-link');

    // Série à chapitre unique : la page est elle-même la page de lecture
    if ($links.length === 0) {
      const chapterNum = this.chapterNumFromPath(finalPath);
      const chapter: Chapter = {
        name: this.formatChapterName(chapterNum),
        url: this.relativize(finalPath),
        chapterNumber: chapterNum,
      };
      return [chapter];
    }

    const chapters: Chapter[] = [];
    $links.each((_i, el) => {
      const $link = $(el);
      const href = $link.attr('href')?.trim() ?? '';
      if (!href) return;
      const chapterNum = this.chapterNumFromPath(this.absUrl(href));
      const chapter: Chapter = {
        name: this.formatChapterName(chapterNum),
        url: this.relativize(this.absUrl(href)),
        chapterNumber: chapterNum,
      };
      const dateUpload = this.parseDate($link.find('p.release-date').first().text());
      if (dateUpload !== undefined) chapter.dateUpload = dateUpload;
      chapters.push(chapter);
    });
    chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('img.comic-image').each((_i, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
    });
    return pages;
  }
}