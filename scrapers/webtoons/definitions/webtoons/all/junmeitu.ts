import { BaseScraper } from '../../../engine/base';
import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `all/junmeitu` (Junmeitu.kt).
 *
 * Site de galeries : séries = albums single-chapter. La pagination des
 * images d'un album est soit récupérée directement dans le HTML (`news-body`),
 * soit reconstruite via les variables `pc_cid` / `pc_id` d'un script inline
 * et des requêtes AJAX (réponses JSON `{"pic": "<img ...>"}`), soit via des
 * URLs de page `slug-N.html`.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - Le moteur TS n'a pas de `getImageUrl(page)` (Page ne porte que
 *   `imageUrl`) : les pages « lazy » (url seule) du Kt sont résolues de façon
 *   eager et séquentielle dans `getPageList`, en appliquant la logique
 *   `getImageUrl` du Kt (JSON si contentType AJAX, sinon `.pictures img`).
 * - Les filtres (Tag/Model/Group/Category/Sort) ne sont pas portés : seul le
 *   branchement `query` de la recherche est conservé (la branche `tags/`,
 *   `model/`, `xzjg/`, catégorie et tri est retirée) ; un query vide retombe
 *   sur la page courante de "latest" comme dans le Kt.
 * - `date_upload` nul du Kt (tryParseDate → 0) devient `undefined`.
 *
 * Note : les albums les plus longs (131 pages observés) font 131 requêtes
 * HTTP séquentielles dans `getPageList`, alors que le Kt ne résout qu'une page
 * à la lecture. Un album entier dépasse donc largement un timeout de 45 s côté
 * appelant ; c'est le comportement eager assumé, pas une régression.
 */

interface JunmeituDto {
  pic: string;
}

function isJunmeituDto(value: unknown): value is JunmeituDto {
  return typeof value === 'object' && value !== null &&
    typeof (value as Record<string, unknown>).pic === 'string';
}

export class JunmeituScraper extends BaseScraper {
  readonly name = 'Junmeitu';
  readonly baseUrl = 'https://meijuntu.com';
  readonly lang = 'all';

  private dateFormat(dateText: string): number | undefined {
    const value = dateText.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return undefined;
    const [_, year, month, day] = match.map(Number);
    const ms = new Date(Date.UTC(year, month - 1, day)).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }

  private imageUrlOf($img: Cheerio<Element>): string {
    const raw = $img.attr('data-original') ??
      $img.attr('data-src') ??
      $img.attr('data-lazy-src') ??
      $img.attr('src') ??
      '';
    return raw;
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.pic-list > ul > li').each((_i, el) => {
      const $li = $(el);
      const $a = $li.find('a').first();
      const url = $a.attr('href');
      if (!url) return;
      mangas.push({
        title: $li.find('p').text(),
        url: this.relativize(this.absUrl(url)),
        thumbnailUrl: this.absUrl($li.find('img').attr('src') ?? '') || '',
        lang: this.lang,
      });
    });
    const hasNextPage = $('span + a + a').length > 0;
    return { mangas, hasNextPage };
  }

  private relativize(pathOrUrl: string): string {
    if (pathOrUrl.startsWith(this.baseUrl)) {
      return pathOrUrl.slice(this.baseUrl.length);
    }
    return pathOrUrl;
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/beauty/index-${page}.html`);
    return this.parseMangaList(res.data);
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/beauty/hot-${page}.html`);
    return this.parseMangaList(res.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    let url: string;
    if (query.length > 0) {
      url = `${this.baseUrl}/search/${query}-${page}.html`;
    } else {
      url = `${this.baseUrl}/beauty/index-${page}.html`;
    }
    const res = await this.get(url);
    return this.parseMangaList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const $ = this.$(res.data);

    const description = $('.news-info, .picture-details')
      .map((_i, el) => $(el).text())
      .get()
      .join(' ')
      .concat('\n', $('.introduce').text());

    const genre = $('.relation_tags > a')
      .map((_i, el) => $(el).text())
      .get()
      .join(', ');

    return {
      title: ($('.news-title, .title').first().text() || undefined),
      description: description.length > 0 ? description : undefined,
      genre: genre.length > 0 ? genre : undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const requestUrl = this.finalRequestUrl(res, abs);
    const $ = this.$(res.data);

    const href = $('.position a:last-child').first().attr('href');
    const url = href ? this.relativize(this.absUrl(href)) : this.relativize(requestUrl);

    const dateText = $('.base-info span:contains(日期)')
      .first()
      .text()
      .split('日期:')[1] ?? '';

    const chapter: Chapter = { url, name: 'Gallery' };
    const dateUpload = this.dateFormat(dateText);
    if (dateUpload !== undefined) chapter.dateUpload = dateUpload;
    return [chapter];
  }

  private finalRequestUrl(res: unknown, fallback: string): string {
    const url = (res as { request?: { responseURL?: string } }).request?.responseURL;
    return url && url.length > 0 ? url : fallback;
  }

  private pathSegmentsOf(url: string): string[] {
    try {
      const path = new URL(url, this.baseUrl).pathname;
      return path.split('/').filter((seg) => seg.length > 0);
    } catch {
      return [];
    }
  }

  private buildAjaxUrl(
    requestUrl: string,
    categoryId: string,
    contentId: string,
  ): URL {
    const base = new URL(requestUrl);
    const segments = this.pathSegmentsOf(requestUrl);
    const cat = segments[0] || 'beauty';
    const pathSegments = base.pathname.split('/').filter((s) => s.length > 0);
    if (pathSegments.length > 0) {
      pathSegments[0] = `ajax_${cat}`;
    }
    base.pathname = `/${pathSegments.join('/')}`;
    base.search = '';
    base.searchParams.set('ajax', '1');
    base.searchParams.set('catid', categoryId);
    base.searchParams.set('conid', contentId);
    return base;
  }

  private setLastPathSegment(url: URL, value: string): string {
    const base = new URL(url.toString());
    const segments = base.pathname.split('/');
    segments[segments.length - 1] = value;
    base.pathname = segments.join('/');
    return base.toString();
  }

  private slugOf(url: string): string {
    const segments = this.pathSegmentsOf(url);
    const last = segments[segments.length - 1] ?? '';
    const withoutExt = last.split('.html')[0];
    // Kotlin `substringBeforeLast("-")` rend la chaîne entière si le
    // séparateur est absent ; `split().slice(0,-1)` la viderait à tort.
    const dash = withoutExt.lastIndexOf('-');
    return dash === -1 ? withoutExt : withoutExt.slice(0, dash);
  }

  /** getImageUrl(el) du Kt : JSON (AJAX) sinon `.pictures img` du HTML */
  private async resolveImageUrl(pageUrl: string): Promise<string> {
    const res = await this.get(pageUrl);
    const finalUrl = this.finalRequestUrl(res, pageUrl);
    const contentType = typeof res.headers['content-type'] === 'string'
      ? (res.headers['content-type'] as string)
      : '';
    const isAjax = contentType.toLowerCase().includes('application/json') ||
      (() => {
        try {
          return new URL(finalUrl).searchParams.get('ajax') === '1';
        } catch {
          return false;
        }
      })();

    if (isAjax) {
      if (!isJunmeituDto(res.data)) {
        throw new Error(`${this.name}: Image not found in AJAX response`);
      }
      const $frag = this.$(res.data.pic);
      const src = $frag('img').first().attr('src');
      if (!src) {
        throw new Error(`${this.name}: Image not found in AJAX response`);
      }
      return this.absUrl(src);
    }

    const $ = this.$(res.data);
    const $img = $('.pictures img').first();
    const src = this.imageUrlOf($img);
    if (!src) {
      throw new Error(`${this.name}: Image not found in HTML response`);
    }
    return this.absUrl(src);
  }

  private numPagesOf($: ReturnType<typeof this.$>): number {
    const nthLastText = $('.pages > a:nth-last-of-type(2)').first().text();
    const nthLast = Number.parseInt(nthLastText, 10);
    if (!Number.isNaN(nthLast)) return nthLast;

    const maxima = $('.pages a')
      .map((_i, el) => Number.parseInt($(el).text(), 10))
      .get()
      .filter((n) => !Number.isNaN(n));
    if (maxima.length > 0) return Math.max(...maxima);

    return 1;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const abs = this.absUrl(chapterUrl);
    const res = await this.get(abs);
    const requestUrl = this.finalRequestUrl(res, abs);
    const $ = this.$(res.data);

    const newsBody = $('.news-body').first();
    if (newsBody.length > 0) {
      const pages: Page[] = [];
      newsBody.find('img').each((_i, el) => {
        pages.push({
          index: pages.length,
          imageUrl: this.absUrl(this.imageUrlOf($(el))),
        });
      });
      return pages;
    }

    const numPages = this.numPagesOf($);
    const slug = this.slugOf(requestUrl);

    const scriptData = $('script')
      .filter((_i, el) => $(el).html()?.includes('pc_cid') ?? false)
      .first()
      .html() ?? null;

    const pageSources: Array<{ direct?: string; url?: string }> = [];
    if (scriptData !== null) {
      const categoryId = scriptData.split('pc_cid = ')[1]?.split(';')[0]?.trim() ?? '';
      const contentId = scriptData.split('pc_id = ')[1]?.split(';')[0]?.trim() ?? '';
      const ajaxUrlBase = this.buildAjaxUrl(requestUrl, categoryId, contentId);

      const firstImage = $('.pictures img').first();
      const firstSrc = this.imageUrlOf(firstImage);
      if (firstSrc.length > 0) {
        pageSources.push({ direct: this.absUrl(firstSrc) });
      } else {
        pageSources.push({ url: this.setLastPathSegment(ajaxUrlBase, `${slug}-1.html`) });
      }
      for (let i = 2; i <= numPages; i++) {
        pageSources.push({ url: this.setLastPathSegment(ajaxUrlBase, `${slug}-${i}.html`) });
      }
    } else {
      for (let i = 1; i <= numPages; i++) {
        const base = new URL(requestUrl);
        pageSources.push({ url: this.setLastPathSegment(base, `${slug}${i > 1 ? `-${i}` : ''}.html`) });
      }
    }

    const pages: Page[] = [];
    for (let i = 0; i < pageSources.length; i++) {
      const entry = pageSources[i];
      const imageUrl = entry.direct !== undefined
        ? entry.direct
        : await this.resolveImageUrl(entry.url ?? '');
      pages.push({ index: i, imageUrl });
    }
    return pages;
  }
}