import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `all/everiaclub` (EveriaClub.kt).
 *
 * WordPress + WP-REST pour les albums. Les posts sont des galeries complètes
 * exposées par l'API REST ; la sélection `_embed=wp:featuredmedia` porte la
 * miniature.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - Les filtres (catégories/tags WP, `firstInstanceOrNull<CategoryFilter>`) ne
 *   sont pas portés : le moteur TS n'expose que `search`. La recherche passe
 *   uniquement le paramètre `search` d'API (uniquement `query` non vide), et
 *   le panneau de filtre (`fetchFilterData`, `getFilterList`) est retiré.
 * - `fetchRelatedMangaList` (mangas liés par genre) n'existe pas dans le
 *   moteur TS : retiré.
 * - Les pages multiples sont résolues de façon eager et séquentielle (le Kt
 *   utilise un sémaphore de concurrence 3 + coroutineScope) ; même résultat.
 */

const DATE_REGEX = /[0-9]{4}\/[0-9]{2}\/[0-9]{2}/;

interface WPRendered {
  rendered: string;
}

interface WPFeaturedMedia {
  source_url: string;
}

interface WPPostDto {
  link: string;
  title: WPRendered;
  _embedded?: {
    'wp:featuredmedia'?: WPFeaturedMedia[];
  };
}

function isWPPostDtoList(value: unknown): value is WPPostDto[] {
  return Array.isArray(value) && (value.length === 0 || isWPPostDto(value[0]));
}

function isWPPostDto(value: unknown): value is WPPostDto {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.link === 'string' && typeof v.title === 'object' && v.title !== null;
}

export class EveriaClubScraper extends BaseScraper {
  readonly name = 'Everia.club';
  readonly baseUrl = 'https://everia.club';
  readonly lang = 'all';

  private thumbnailUrl(pathOrSrc: string): string {
    const abs = this.absUrl(pathOrSrc);
    return abs.length > 0 && !abs.startsWith('data:') ? abs : '';
  }

  private stripDomain(rawUrl: string): string {
    const u = new URL(rawUrl, this.baseUrl);
    return u.pathname + u.search;
  }

  /** posts Kt : wrapper direct, la pagination vient du header X-WP-TotalPages */
  private async fetchPosts(url: URL): Promise<SearchResult> {
    const res = await this.get(url.toString());
    const totalPages = Number((res.headers['x-wp-totalpages' as keyof typeof res.headers] as string) ?? '0') || 0;
    const currentPage = Number(url.searchParams.get('page') ?? '0') || 0;
    const posts = res.data;
    if (!isWPPostDtoList(posts)) return { mangas: [], hasNextPage: false };

    const mangas: Manga[] = posts.map(post => ({
      title: this.unescapeEntities(post.title.rendered),
      url: this.stripDomain(post.link),
      thumbnailUrl: post._embedded?.['wp:featuredmedia']?.[0]?.source_url || '',
      lang: this.lang,
    }));

    return { mangas, hasNextPage: currentPage < totalPages };
  }

  private unescapeEntities(html: string): string {
    // Parser.unescapeEntities(html, false)
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  async getPopular(_page: number = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.wli_popular_posts-class li').each((_i, el) => {
      const $li = $(el);
      mangas.push({
        title: $li.find('h3').text(),
        url: this.stripDomain(this.absUrl($li.find('h3 > a').attr('href') ?? '')),
        thumbnailUrl: this.thumbnailUrl($li.find('img').first().attr('data-lazy-src') ?? $li.find('img').first().attr('data-src') ?? $li.find('img').first().attr('src') ?? ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/posts`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '20');
    url.searchParams.set('_embed', 'wp:featuredmedia');
    return this.fetchPosts(url);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/posts`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '20');
    url.searchParams.set('_embed', 'wp:featuredmedia');
    if (query.trim().length > 0) url.searchParams.set('search', query.trim());
    return this.fetchPosts(url);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('.entry-title').text(),
      description: $('.entry-title').text(),
      genre: $('.post-tags > a')
        .map((_i, el) => $(el).text())
        .get()
        .join(', '),
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const canonicalUrl =
      $('link[rel="canonical"]').attr('href') || this.absUrl(mangaUrl);
    const chapter: Chapter = {
      name: 'Gallery',
      url: this.stripDomain(canonicalUrl),
      chapterNumber: -2,
    };
    const date = this.getDate(canonicalUrl);
    if (date !== undefined) chapter.dateUpload = date;
    return [chapter];
  }

  private getDate(str: string): number | undefined {
    const match = DATE_REGEX.exec(str);
    if (!match) return undefined;
    const [year, month, day] = match[0].split('/').map(Number);
    if (!year || !month || !day) return undefined;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? undefined : date.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const document = await this.get(chapterUrl);
    const $ = this.$(document.data);

    const pageLinks: string[] = [];
    $('.page-links a.post-page-numbers').each((_i, el) => {
      const href = this.absUrl($(el).attr('href') ?? '');
      if (href && !pageLinks.includes(href)) pageLinks.push(href);
    });

    const parseImages = (html: string): string[] => {
      const $doc = this.$(html);
      $doc('noscript').remove();
      const urls: string[] = [];
      $doc('.entry-content img').each((_i, el) => {
        const src =
          $doc(el).attr('data-lazy-src') ||
          $doc(el).attr('data-src') ||
          $doc(el).attr('src') ||
          '';
        if (src) urls.push(this.absUrl(src));
      });
      return urls;
    };

    let urls = parseImages(document.data);
    if (pageLinks.length > 0) {
      for (const link of pageLinks) {
        try {
          const res = await this.get(link);
          urls = urls.concat(parseImages(res.data));
        } catch {
          // Page de détail qui échoue : ignore (runCatching du Kt).
        }
      }
    }

    const distinct = urls.filter((url, i) => urls.indexOf(url) === i);
    const pages: Page[] = [];
    distinct.forEach((url) => {
      if (url.length > 0 && !url.startsWith('data:image')) {
        pages.push({ index: pages.length, imageUrl: url });
      }
    });
    return pages;
  }
}