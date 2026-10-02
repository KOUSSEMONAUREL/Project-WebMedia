import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `all/comicskingdom` (ComicsKingdom.kt).
 *
 * WordPress + WP-REST galerie de comics. Chaque série expose ses uploads
 * journaliers/hebdomadaires via une API compacte (`ck_comic`).
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - Le mode « compact chapters » (par défaut côté kt, préférence
 *   `compactPref`) est câblé en dur : chaque lot API de 100 chapitres devient
 *   un chapitre « date1-date2 ». Le mode « chaque upload = un chapitre »,
 *   qui peut atteindre 8000+ chapitres pour certains comics, n'est pas porté
 *   (pas de mécanisme de préférence dans ce moteur).
 * - Les filtres (tri `orderby`, genres `ck_genre`/`ck_genre_exclude`) ne
 *   sont pas portés : le moteur n'expose que `search`. La recherche utilise
 *   le paramètre `search` de l'API, tri par défaut du site.
 * - `ck_language=spanish` n'est utilisé que si `lang == 'es'` ; ici `lang`
 *   vaut `'all'`, donc l'API est appelée en `english`.
 */

const MANGA_FIELDS = 'id,link,title,content,meta,yoast_head';
const CHAPTER_FIELDS = 'id,date,assets,link';

const THUMBNAIL_URL_REGEX = /thumbnailUrl":"(\S+)","dateP/;
const COMPACT_CHAPTER_COUNT_REGEX = /"totalItems":(\d+)/g;

const MANGA_PER_PAGE = 20;
const CHAPTER_PER_PAGE = 100;

interface Rendered {
  rendered: string;
}

interface CkFeature {
  id: number;
  link: string;
  title: Rendered;
  content: Rendered;
  meta: { ck_byline_on_app: string };
  yoast_head: string;
}

interface CkAssets {
  single: { url: string };
}

interface CkChapter {
  id: number;
  date: string;
  assets?: CkAssets;
  link: string;
}

function isCkFeature(value: unknown): value is CkFeature {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'number' && typeof v.link === 'string' && typeof v.yoast_head === 'string';
}

function isCkFeatureList(value: unknown): value is CkFeature[] {
  return Array.isArray(value) && (value.length === 0 || isCkFeature(value[0]));
}

function isCkChapterList(value: unknown): value is CkChapter[] {
  return Array.isArray(value) && (value.length === 0 || isCkChapter(value[0]));
}

function isCkChapter(value: unknown): value is CkChapter {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'number' && typeof v.date === 'string' && typeof v.link === 'string';
}

export class ComicsKingdomScraper extends BaseScraper {
  readonly name = 'Comics Kingdom';
  readonly baseUrl = 'https://wp.comicskingdom.com';
  readonly lang = 'all';

  private mangaApiUrl(): URL {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/ck_feature`);
    url.searchParams.set('per_page', String(MANGA_PER_PAGE));
    url.searchParams.set('_fields', MANGA_FIELDS);
    // Le Kt choisit `spanish`/`english` selon `lang` ; le port fusionne les
    // sources sous `lang='all'`, donc seul `english` est atteignable.
    url.searchParams.set('ck_language', 'english');
    return url;
  }

  private chapterApiUrl(): URL {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/ck_comic`);
    url.searchParams.set('per_page', String(CHAPTER_PER_PAGE));
    url.searchParams.set('_fields', CHAPTER_FIELDS);
    return url;
  }

  /** Chemin relatif (path + query) d'une URL, comme setUrlWithoutDomain. */
  private relative(url: URL): string {
    return url.pathname + url.search;
  }

  private thumbnailFromYoast(yoastHead: string): string {
    const match = THUMBNAIL_URL_REGEX.exec(yoastHead);
    return match ? match[1] : '';
  }

  private async getMangaList(orderBy: string, page: number): Promise<SearchResult> {
    const url = this.mangaApiUrl();
    url.searchParams.set('orderBy', orderBy);
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());

    const list = res.data;
    if (!isCkFeatureList(list)) return { mangas: [], hasNextPage: false };

    const mangas: Manga[] = list.map(item => {
      const api = this.mangaApiUrl();
      api.pathname = `${api.pathname}/${item.id}`;
      const slug = decodeURIComponent(item.link.split('/').filter(Boolean).pop() || '');
      if (slug) api.searchParams.set('slug', slug);
      return {
        title: item.title.rendered,
        url: this.relative(api),
        thumbnailUrl: this.thumbnailFromYoast(item.yoast_head),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: mangas.length === MANGA_PER_PAGE };
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    return this.getMangaList('relevance', page);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    return this.getMangaList('modified', page);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const url = this.mangaApiUrl();
    url.searchParams.set('search', query.trim());
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());

    const list = res.data;
    if (!isCkFeatureList(list)) return { mangas: [], hasNextPage: false };

    const mangas: Manga[] = list.map(item => {
      const api = this.mangaApiUrl();
      api.pathname = `${api.pathname}/${item.id}`;
      const slug = decodeURIComponent(item.link.split('/').filter(Boolean).pop() || '');
      if (slug) api.searchParams.set('slug', slug);
      return {
        title: item.title.rendered,
        url: this.relative(api),
        thumbnailUrl: this.thumbnailFromYoast(item.yoast_head),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: mangas.length === MANGA_PER_PAGE };
  }

  private async fetchFeature(mangaUrl: string): Promise<CkFeature> {
    const res = await this.get(mangaUrl);
    if (!isCkFeature(res.data)) throw new Error(`${this.name}: invalid CK feature payload`);
    return res.data;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const data = await this.fetchFeature(mangaUrl);
    const byline = data.meta.ck_byline_on_app;
    const idx = byline.indexOf('By');
    const author = (idx === -1 ? byline : byline.slice(idx + 2)).trim();
    const $ = this.$(data.content.rendered);
    return {
      title: data.title.rendered,
      url: mangaUrl,
      author: author || undefined,
      description: $.text() || undefined,
      status: 3,
      thumbnailUrl: this.thumbnailFromYoast(data.yoast_head),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const data = await this.fetchFeature(mangaUrl);
    const mangaName = decodeURIComponent(data.link.split('/').filter(Boolean).pop() || '');

    const countRes = await this.get(data.link);
    const body = typeof countRes.data === 'string' ? countRes.data : JSON.stringify(countRes.data);
    let postCount = 0;
    COMPACT_CHAPTER_COUNT_REGEX.lastIndex = 0;
    for (const match of body.matchAll(COMPACT_CHAPTER_COUNT_REGEX)) {
      const value = Number(match[1]);
      if (value > 0) {
        postCount = value;
        break;
      }
    }

    const maxPage = Math.ceil(postCount / CHAPTER_PER_PAGE);
    const chapters: Chapter[] = [];
    for (let idx = 0; idx < maxPage; idx++) {
      const api = this.chapterApiUrl();
      api.searchParams.set('orderBy', 'date');
      api.searchParams.set('order', 'asc');
      api.searchParams.set('ck_feature', mangaName);
      api.searchParams.set('page', String(idx + 1));
      const upper = (idx + 1) * CHAPTER_PER_PAGE;
      const last = postCount - upper < 0 ? Math.trunc(postCount) : upper;
      chapters.push({
        name: `${idx * CHAPTER_PER_PAGE + 1}-${last}`,
        url: this.relative(api),
        chapterNumber: idx * 0.01,
      });
    }
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const list = res.data;
    if (!isCkChapterList(list)) {
      if (isCkChapter(res.data) && res.data.assets) {
        return [{ index: 0, imageUrl: res.data.assets.single.url }];
      }
      return [];
    }
    const pages: Page[] = [];
    list.forEach((chapter, index) => {
      if (!chapter.assets) return;
      pages.push({ index, imageUrl: chapter.assets.single.url });
    });
    return pages;
  }
}