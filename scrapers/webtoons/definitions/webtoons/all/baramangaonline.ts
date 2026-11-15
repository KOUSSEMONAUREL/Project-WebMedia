import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface RenderedDto {
  rendered?: string;
}

interface PostDto {
  id: number;
  title?: RenderedDto;
  categories?: number[];
  yoast_head_json?: {
    og_image?: Array<{ url?: string }>;
  };
}

interface PostDetailsDto extends PostDto {
  date_gmt?: string;
  _embedded?: {
    'wp:term'?: TermDto[][];
  };
}

interface TermDto {
  name?: string;
  link?: string;
  taxonomy?: string;
}

interface PostContentDto {
  content?: RenderedDto;
}

const LIST_FIELDS = 'id,title,categories,yoast_head_json.og_image';
const DETAILS_FIELDS = 'id,title,date_gmt,yoast_head_json.og_image,_links.wp:term,_embedded';
const EXCLUDED_CATEGORIES = '115,146,345';
const PER_PAGE = 24;

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

export class BaraMangaOnlineScraper extends BaseScraper {
  readonly name = 'Bara Manga Online';
  readonly baseUrl = 'https://baramangaonline.com';
  readonly lang = 'all';

  private async getPosts(page: number, query?: string): Promise<SearchResult> {
    const params = new URLSearchParams({
      per_page: String(PER_PAGE),
      page: String(page),
      categories_exclude: EXCLUDED_CATEGORIES,
      _fields: LIST_FIELDS,
    });
    if (query?.trim()) params.set('search', query.trim());

    const res = await this.get(`/wp-json/wp/v2/posts?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const totalPages = Number(res.headers['x-wp-totalpages'] ?? 0);
    const posts = parseJson<PostDto[]>(res.data) ?? [];
    return {
      mangas: posts.map(post => this.toManga(post)),
      hasNextPage: Number.isFinite(totalPages) && page < totalPages,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getPosts(page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPosts(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.getPosts(page, query);
  }

  private toManga(post: PostDto): Manga {
    return {
      title: decodeEntities(post.title?.rendered ?? String(post.id)),
      url: `${this.baseUrl}/?p=${post.id}`,
      thumbnailUrl: (post.yoast_head_json?.og_image?.[0]?.url ?? '').replace(/^http:\/\//, 'https://'),
      lang: this.lang,
    };
  }

  private async fetchDetails(id: string): Promise<PostDetailsDto | undefined> {
    const params = new URLSearchParams({
      _embed: 'wp:term',
      _fields: DETAILS_FIELDS,
    });
    const res = await this.get(`/wp-json/wp/v2/posts/${id}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    return parseJson<PostDetailsDto>(res.data);
  }

  private idFromUrl(mangaUrl: string): string | undefined {
    if (/^\d+$/.test(mangaUrl)) return mangaUrl;
    try {
      const url = new URL(mangaUrl, this.baseUrl);
      return url.searchParams.get('p') ?? url.pathname.split('/').filter(Boolean).pop();
    } catch {
      return undefined;
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.idFromUrl(mangaUrl);
    if (!id) return {};
    const post = await this.fetchDetails(id);
    if (!post) return {};

    const terms = (post._embedded?.['wp:term'] ?? []).flat();
    const categories = terms.filter(term => term.taxonomy === 'category');
    const languages = categories.filter(term => term.link?.includes('/category/languages/'));
    const genres = categories
      .filter(term => !languages.includes(term))
      .map(term => decodeEntities(term.name ?? ''))
      .filter(Boolean);

    return {
      ...this.toManga(post),
      url: this.absUrl(mangaUrl),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: languages.length > 0
        ? `Language: ${languages.map(term => decodeEntities(term.name ?? '')).join(', ')}`
        : undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.idFromUrl(mangaUrl);
    if (!id) return [];
    const post = await this.fetchDetails(id);
    if (!post) return [];

    const date = post.date_gmt ? Date.parse(post.date_gmt + 'Z') : Number.NaN;
    return [{
      name: 'Chapter',
      url: `${this.baseUrl}/?p=${post.id}`,
      chapterNumber: 1,
      dateUpload: Number.isNaN(date) ? undefined : date,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = this.idFromUrl(chapterUrl);
    if (!id) return [];

    const res = await this.get(`/wp-json/wp/v2/posts/${id}?_fields=content`, {
      headers: { Accept: 'application/json' },
    });
    const content = parseJson<PostContentDto>(res.data).content?.rendered ?? '';
    const $ = this.$(content);

    return $('img')
      .toArray()
      .map(element => $(element).attr('src') ?? '')
      .filter(Boolean)
      .map((src, index) => ({ index, imageUrl: this.absUrl(src) }));
  }
}
