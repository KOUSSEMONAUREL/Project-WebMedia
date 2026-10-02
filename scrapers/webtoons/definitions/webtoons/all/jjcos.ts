import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `all/jjcos` (JJCOS.kt + Dto.kt).
 *
 * Cosplay gallery source. The catalogue is the JSON index at
 * `/api/index.html?page=N` (`{ posts: [{ title, link, feature, content }] }`);
 * pagination is applied client-side with PAGE_SIZE 20 and search filters
 * title/content client-side. Each post is a single "Gallery" chapter whose
 * pages are `#post-content img` (+ article variants).
 */

interface PostDto {
  title: string;
  link: string;
  feature?: string | null;
  content?: string | null;
  dateFormat?: string | null;
}

interface IndexDto {
  posts: PostDto[];
}

const PAGE_SIZE = 20;

export class JjcosScraper extends BaseScraper {
  readonly name = 'JJCOS';
  readonly baseUrl = 'https://jjcos.com';
  readonly lang = 'all';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const posts = await this.fetchIndex(page);
    return this.toMangasPage(posts, page);
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error('getLatest is not supported by JJCOS');
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const posts = await this.fetchIndex(page, query.trim() || undefined);
    const term = query.trim().toLowerCase();
    if (!term) return this.toMangasPage(posts, page);
    const filtered = posts.filter(
      p =>
        p.title.toLowerCase().includes(term) ||
        (p.content ?? '').toLowerCase().includes(term),
    );
    return this.toMangasPage(filtered, page);
  }

  private async fetchIndex(page: number, query?: string): Promise<PostDto[]> {
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('query', query);
    const res = await this.get(`${this.baseUrl}/api/index.html?${params.toString()}`);
    const data = res.data as IndexDto;
    return Array.isArray(data?.posts) ? data.posts : [];
  }

  private toMangasPage(posts: PostDto[], page: number): SearchResult {
    const start = (Math.max(1, page) - 1) * PAGE_SIZE;
    if (start >= posts.length) return { mangas: [], hasNextPage: false };
    const end = Math.min(posts.length, start + PAGE_SIZE);
    const mangas: Manga[] = posts.slice(start, end).map(p => ({
      title: p.title.trim(),
      url: this.linkToPath(p.link),
      thumbnailUrl: p.feature ?? '',
      lang: this.lang,
      status: 0,
    }));
    return { mangas, hasNextPage: end < posts.length };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const rawTitle = $('h1.fh5co-article-title').first().text().trim();
    const title = rawTitle.replace(/ - JJCOS$/, '').trim();
    const thumbnailUrl =
      $('#post-content img, article img').first().attr('src') ??
      $('#post-content img, article img').first().attr('data-src') ??
      '';
    const genre = $('.tag-container a.tag')
      .toArray()
      .map(a => $(a).text().replace(/^#/, '').trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(', ');
    return {
      title: title || undefined,
      url: this.normalizePath(mangaUrl),
      thumbnailUrl: thumbnailUrl ? this.absUrl(thumbnailUrl) : '',
      lang: this.lang,
      genre: genre || undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const finalPath = this.responsePath(res, mangaUrl);
    const $ = this.$(res.data as string);
    const rawDate =
      $('meta[property="article:published_time"]').first().attr('content') ??
      $('.breadcrumb-item.date-overlay').first().text().trim() ??
      '';
    return [
      {
        name: 'Gallery',
        url: this.normalizePath(finalPath),
        ...(this.parseDate(rawDate) !== undefined ? { dateUpload: this.parseDate(rawDate) as number } : {}),
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data as string);
    const seen = new Set<string>();
    const pages: Page[] = [];
    $('#post-content img, article #post-content img, article p img').each((_, el) => {
      const $img = $(el);
      const src = ($img.attr('src') || $img.attr('data-src') || '').trim();
      if (!src || seen.has(this.absUrl(src))) return;
      seen.add(this.absUrl(src));
      pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private linkToPath(link: string): string {
    const sanitized = link.trim().split('?')[0]?.split('#')[0] ?? link;
    const absolute = /^https?:\/\//i.test(sanitized)
      ? sanitized
      : sanitized.startsWith('/')
        ? `${this.baseUrl}${sanitized}`
        : `${this.baseUrl}/${sanitized}`;
    return this.normalizePath(absolute.replace(/ /g, '%20'));
  }

  private normalizePath(path: string): string {
    try {
      const u = new URL(path, this.baseUrl);
      return u.pathname;
    } catch {
      return path.startsWith('/') ? path : `/${path}`;
    }
  }

  private responsePath(res: { request?: unknown }, fallback: string): string {
    try {
      const req = res.request as {
        responseURL?: string;
        res?: { responseUrl?: string };
        path?: string;
      };
      const finalUrl = req?.responseURL ?? req?.res?.responseUrl;
      if (finalUrl) return new URL(finalUrl).pathname;
    } catch {
      // fall through to fallback
    }
    return this.normalizePath(fallback);
  }

  private parseDate(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    // Upstream tries "yyyy-MM-dd HH:mm:ss" then "yyyy-MM-dd".
    const dt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(trimmed);
    if (dt) {
      const time = Date.UTC(
        Number(dt[1]), Number(dt[2]) - 1, Number(dt[3]),
        Number(dt[4]), Number(dt[5]), Number(dt[6]),
      );
      return Number.isNaN(time) ? undefined : time;
    }
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (d) {
      const time = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
      return Number.isNaN(time) ? undefined : time;
    }
    const fallback = Date.parse(trimmed);
    return Number.isNaN(fallback) ? undefined : fallback;
  }
}
