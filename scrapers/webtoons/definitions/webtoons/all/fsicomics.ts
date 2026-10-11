import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `all/fsicomics` (FsiComics.kt + Dto.kt),
 * English source (`https://fsicomics.com`; the extension also ships es/de/fr
 * mirrors, of which only `en` is ported here).
 *
 * WordPress site read through the public REST API, exactly like the Kt:
 * - Popular: `wp-json/wordpress-popular-posts/v1/popular-posts`
 *   (`range=last30days`, `order_by=views`), mirroring the site's
 *   "Trending Comics This Month" section.
 * - Latest / search: `wp-json/wp/v2/posts` (`search=` for queries).
 * - Details: the post page (`h1.s-title`, `og:description`, `a[rel=tag]`,
 *   `time.published`); status is COMPLETED with a single `Chapter`, as the Kt
 *   sets `UpdateStrategy.ONLY_FETCH_ONCE`.
 * - Pages: `.entry-content .wp-block-gallery img`, with the Kt's `-scaled`
 *   suffix stripped back to the full-size file.
 *
 * Verified live 2026-10-11 (`curl -4`): popular-posts 200 (3 requested, full
 * payloads with `link`/`title.rendered`/`_embedded`), `wp/v2/posts` 200 with
 * posts dated 2026-10-11, series page 200 with `h1.s-title`, 7 `rel=tag`
 * links and 45 entry-content images.
 *
 * Deliberate divergences from the Kt: the genre/tag/sort `FilterList`
 * (WordPress category tree + tag-id resolution) is not ported — a search with
 * an empty query falls back to `getPopular`, and genre filtering is left to
 * the worker. `rateLimit(2)` has no engine equivalent.
 */

interface WpRendered {
  rendered: string;
}

interface WpFeaturedMedia {
  source_url: string;
}

interface WpEmbedded {
  'wp:featuredmedia'?: WpFeaturedMedia[];
}

interface WpPost {
  link: string;
  title: WpRendered;
  categories: number[];
  _embedded?: WpEmbedded;
}

const API_LIMIT = 20;
/** Only the EN site has a video category; other locales return none (Kt). */
const EXCLUDED_CATEGORIES = new Set([320]);
const SCALED_SUFFIX_REGEX = /-scaled(\.\w+)$/;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, digits: string) => String.fromCharCode(Number.parseInt(digits, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, digits: string) => String.fromCharCode(Number.parseInt(digits, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) as T : data as T);
}

export class FsiComicsScraper extends BaseScraper {
  readonly name = 'FSI Comics';
  readonly baseUrl = 'https://fsicomics.com';
  readonly lang = 'all';

  private toManga(post: WpPost): Manga {
    let path = '/';
    try {
      path = new URL(post.link).pathname;
    } catch {
      path = post.link;
    }
    return {
      title: decodeEntities(post.title.rendered),
      url: path,
      thumbnailUrl: post._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? '',
      lang: this.lang,
    };
  }

  private async fetchPosts(url: string, page: number): Promise<SearchResult> {
    const res = await this.get(url);
    const posts = parseJson<WpPost[]>(res.data).filter(
      (post) => post.categories.every((id) => !EXCLUDED_CATEGORIES.has(id)),
    );
    const totalPages = Number.parseInt(String(res.headers['x-wp-totalpages'] ?? '0'), 10);
    return {
      mangas: posts.map((post) => this.toManga(post)),
      hasNextPage: Number.isFinite(totalPages) && totalPages > 0 ? page < totalPages : false,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({
      limit: String(API_LIMIT),
      offset: String((page - 1) * API_LIMIT),
      range: 'last30days',
      order_by: 'views',
      embed: 'true',
      _embed: 'wp:featuredmedia',
      _fields: 'title,link,categories,_embedded,_links.wp:featuredmedia',
    });
    const res = await this.get(`/wp-json/wordpress-popular-posts/v1/popular-posts?${params.toString()}`);
    const posts = parseJson<WpPost[]>(res.data).filter(
      (post) => post.categories.every((id) => !EXCLUDED_CATEGORIES.has(id)),
    );
    return { mangas: posts.map((post) => this.toManga(post)), hasNextPage: posts.length >= API_LIMIT };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(API_LIMIT),
      _embed: 'wp:featuredmedia',
    });
    return this.fetchPosts(`/wp-json/wp/v2/posts?${params.toString()}`, page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) return this.getPopular(page);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(API_LIMIT),
      _embed: 'wp:featuredmedia',
      search: query.trim(),
    });
    return this.fetchPosts(`/wp-json/wp/v2/posts?${params.toString()}`, page);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const title = ($('h1.s-title').first().text() || '').trim();
    if (!title) throw new Error('Title is mandatory');
    const description = ($('meta[property="og:description"]').attr('content') || '').trim() || undefined;
    const genre = $('a[rel=tag]').toArray().map((el) => $(el).text().trim()).filter(Boolean).join(', ') || undefined;
    const thumbnailUrl = this.absUrl($('meta[property="og:image"]').attr('content') || '');
    return { title, url: mangaUrl, thumbnailUrl, description, genre, status: 0, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const datetime = $('time.published').first().attr('datetime') || '';
    const parsed = datetime ? Date.parse(datetime) : NaN;
    return [{
      name: 'Chapter',
      url: mangaUrl,
      dateUpload: Number.isNaN(parsed) ? undefined : parsed,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const urls = $('.entry-content .wp-block-gallery img').toArray()
      .map((el) => $(el).attr('src') || '')
      .filter((src) => src && !src.startsWith('data:image'))
      .map((src) => SCALED_SUFFIX_REGEX.exec(src)?.[1] !== undefined
        ? src.replace(SCALED_SUFFIX_REGEX, '$1')
        : src);
    return [...new Set(urls)].map((imageUrl, index) => ({ index, imageUrl: this.absUrl(imageUrl) }));
  }
}

export default FsiComicsScraper;
