import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `all/jjcos` (JJCOS.kt).
 *
 * L'index est un dump JSON (`/api/index.html?page=N&query=...`) renvoyant tous
 * les posts ; la pagination (`PAGE_SIZE = 20`) et le filtrage par `query` sont
 * appliqués côté client, comme dans le Kt. `supportsLatest = false` :
 * getLatest lève une exception.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - `getMangaByUrl` (entrée par URL hors catalogue) n'existe pas dans le
 *   moteur TS : la normalisation d'URL est conservée dans le port (même
 *   `linkToEncodedPath` / `normalizePath`), la garde d'hôte est retirée.
 * - Les filtres de recherche (aucun dans cette source) sont retirés.
 * - La date de chapitre ne peut pas être zéro (Kt `date_upload = 0L` quand
 *   non parsable) : `undefined` est utilisé.
 */

const PAGE_SIZE = 20;

interface IndexDto {
  posts: PostDto[];
}

interface PostDto {
  title: string;
  link: string;
  feature?: string | null;
  content?: string | null;
  dateFormat?: string | null;
}

function isIndexDto(value: unknown): value is IndexDto {
  if (typeof value !== 'object' || value === null) return false;
  const posts = (value as Record<string, unknown>).posts;
  return Array.isArray(posts) && posts.every(isPostDto);
}

function isPostDto(value: unknown): value is PostDto {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === 'string' && typeof v.link === 'string';
}

export class JJCOSScraper extends BaseScraper {
  readonly name = 'JJCOS';
  readonly baseUrl = 'https://jjcos.com';
  readonly lang = 'all';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const posts = await this.fetchIndex(page);
    return this.toMangasPage(posts, page);
  }

  async getLatest(_page: number = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not supported`);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const posts = await this.fetchIndex(page, query);
    const trimmedQuery = query.trim();
    const filteredPosts = trimmedQuery.length === 0
      ? posts
      : posts.filter(post =>
          post.title.toLowerCase().includes(trimmedQuery.toLowerCase()) ||
          (post.content?.toLowerCase().includes(trimmedQuery.toLowerCase()) ?? false),
        );
    return this.toMangasPage(filteredPosts, page);
  }

  private async fetchIndex(page: number, query?: string): Promise<PostDto[]> {
    const url = new URL(`${this.baseUrl}/api/index.html`);
    url.searchParams.set('page', String(page));
    if (query !== undefined && query.trim().length > 0) {
      url.searchParams.set('query', query);
    }
    const res = await this.get(url.toString());
    if (!isIndexDto(res.data)) {
      throw new Error(`${this.name}: unexpected index payload`);
    }
    return res.data.posts;
  }

  private toMangasPage(posts: PostDto[], page: number): SearchResult {
    const startIndex = (Math.max(page, 1) - 1) * PAGE_SIZE;
    if (startIndex >= posts.length) {
      return { mangas: [], hasNextPage: false };
    }
    const endIndexExclusive = Math.min(posts.length, startIndex + PAGE_SIZE);
    const mangas = posts.slice(startIndex, endIndexExclusive).map(post =>
      this.toSManga(post, this.linkToEncodedPath(post.link)),
    );
    return { mangas, hasNextPage: endIndexExclusive < posts.length };
  }

  private toSManga(post: PostDto, encodedPath: string): Manga {
    return {
      title: post.title.trim(),
      url: encodedPath,
      thumbnailUrl: post.feature ?? '',
      status: 0,
      lang: this.lang,
    };
  }

  private linkToEncodedPath(link: string): string {
    const sanitized = link.trim().split('?')[0].split('#')[0];
    const absolute = sanitized.startsWith('http://') || sanitized.startsWith('https://')
      ? sanitized
      : sanitized.replace(/\s/g, '%20');
    const parsed = new URL(absolute.startsWith('/') ? `${this.baseUrl}${absolute}` : absolute);
    return this.normalizePath(parsed.pathname);
  }

  private normalizePath(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const parsed = new URL(`${this.baseUrl}${normalized}`);
    return parsed.pathname;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const postPath = this.finalPathname(res, abs);
    const $ = this.$(res.data);

    const rawTitle = $('h1.fh5co-article-title')
      .first()
      .text()
      .replace(/ - JJCOS$/, '')
      .trim();

    const thumbnail = $('#post-content img, article img').first().attr('src');

    const genre = $('.tag-container a.tag')
      .map((_i, el) => $(el).text().replace(/^#/, '').trim())
      .get()
      .filter((t) => t.length > 0)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .join(', ');

    return {
      title: rawTitle.length > 0 ? rawTitle : undefined,
      url: postPath,
      thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : undefined,
      genre: genre.length > 0 ? genre : undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const postPath = this.finalPathname(res, abs);
    const $ = this.$(res.data);

    const dateText =
      $('meta[property="article:published_time"]').attr('content') ??
      $('.breadcrumb-item.date-overlay').first().text();

    const chapter: Chapter = {
      url: this.normalizePath(postPath),
      name: 'Gallery',
    };
    const dateUpload = this.parseDate(dateText);
    if (dateUpload !== undefined) chapter.dateUpload = dateUpload;
    return [chapter];
  }

  private finalPathname(res: unknown, fallback: string): string {
    const url = (res as { request?: { responseURL?: string } }).request?.responseURL;
    if (url) {
      try {
        return new URL(url).pathname;
      } catch {
        // ignore
      }
    }
    try {
      return new URL(fallback).pathname;
    } catch {
      return fallback;
    }
  }

  private parseDate(rawDate: string | undefined): number | undefined {
    if (!rawDate) return undefined;
    const value = rawDate.trim();
    const dateTime = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (dateTime) {
      const [_, y, mo, d, h, mi, s] = dateTime.map(Number);
      const ms = new Date(Date.UTC(y, mo - 1, d, h, mi, s)).getTime();
      return Number.isNaN(ms) ? undefined : ms;
    }
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const [_, y, mo, d] = dateOnly.map(Number);
      const ms = new Date(Date.UTC(y, mo - 1, d)).getTime();
      return Number.isNaN(ms) ? undefined : ms;
    }
    return undefined;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    const imageUrls = new Set<string>();
    $('#post-content img, article #post-content img, article p img').each((_i, el) => {
      const $img = $(el);
      const raw = $img.attr('src') ?? $img.attr('data-src') ?? '';
      const url = this.absUrl(raw).trim();
      if (url.length > 0) imageUrls.add(url);
    });
    const pages: Page[] = [];
    imageUrls.forEach((imageUrl) => {
      pages.push({ index: pages.length, imageUrl });
    });
    return pages;
  }
}