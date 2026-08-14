import { AxiosError } from 'axios';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const BASE_URL = 'https://hiperdex.tv';
const MANGA_PATH = 'manga';
const CFG_AUTH = 'yceqt7qgu004';
const MAX_RATING = 'pornographic';
const SEARCH_LIMIT = 30;
const CHAPTER_LIMIT = 20;
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

interface TrpcElement {
  result?: { data?: { json?: unknown } };
}

interface MangaDto {
  id: number;
  slug: string;
  title: string;
  synopsis?: string | null;
  coverUrl?: string | null;
  status?: string | null;
  genres?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  type?: string | null;
  contentRating?: string | null;
}

interface SearchWrapperDto {
  hits?: MangaDto[];
}

interface ChapterDto {
  id: number;
  number: number;
  title?: string | null;
  createdAt: string;
}

interface PageDto {
  pageOrder: number;
  webpUrl: string;
  avifUrl?: string | null;
}

function lastJson(elements: TrpcElement[]): unknown {
  const last = elements[elements.length - 1];
  return last?.result?.data?.json ?? null;
}

export class HiperdexScraper extends BaseScraper {
  readonly name = 'Hiperdex';
  readonly baseUrl = BASE_URL;
  readonly lang = 'en';

  private cookies = '';
  private cookieWarmed = false;

  private async warmCookie(): Promise<void> {
    if (this.cookieWarmed) return;
    const res = await this.get(this.baseUrl, { headers: { Accept: HTML_ACCEPT } });
    const raw = res.headers['set-cookie'];
    const setCookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    this.cookies = setCookies.map(c => c.split(';')[0]).join('; ');
    this.cookieWarmed = true;
  }

  private async apiGet(url: string): Promise<unknown> {
    const headers: Record<string, string> = { 'x-cfg-auth': CFG_AUTH };
    if (this.cookies) headers.Cookie = this.cookies;
    const run = () => this.get(url, { headers });
    try {
      return (await run()).data;
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 401) {
        await this.warmCookie();
        if (this.cookies) headers.Cookie = this.cookies;
        return (await run()).data;
      }
      throw err;
    }
  }

  private trpcUrl(procedure: string, input: Record<string, unknown>): string {
    return `${BASE_URL}/api/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
  }

  private searchInput(query: string, sort: string, page: number): Record<string, unknown> {
    return {
      0: {
        json: {
          q: query,
          sort,
          filters: {
            genres: null,
            type: null,
            status: null,
            contentRating: null,
            author: null,
            artist: null,
            year: null,
          },
          limit: SEARCH_LIMIT,
          offset: (page - 1) * SEARCH_LIMIT,
          maxRating: MAX_RATING,
        },
        meta: {
          values: {
            'filters.genres': ['undefined'],
            'filters.type': ['undefined'],
            'filters.status': ['undefined'],
            'filters.contentRating': ['undefined'],
            'filters.author': ['undefined'],
            'filters.artist': ['undefined'],
            'filters.year': ['undefined'],
          },
        },
      },
    };
  }

  private async search(input: Record<string, unknown>): Promise<SearchResult> {
    const data = (await this.apiGet(this.trpcUrl('search.query', input))) as TrpcElement[];
    const wrapper = (data[0]?.result?.data?.json ?? null) as SearchWrapperDto | null;
    const mangas = (wrapper?.hits ?? []).map(hit => this.toManga(hit));
    return { mangas, hasNextPage: mangas.length > 0 };
  }

  private getSlug(url: string): string {
    const marker = `${MANGA_PATH}/`;
    const idx = url.lastIndexOf(marker);
    if (idx === -1) return '';
    return url.slice(idx + marker.length).split('/')[0].split('#')[0];
  }

  private toStatus(status: string | null | undefined): MangaStatus {
    switch (status?.toLowerCase()) {
      case 'ongoing':
        return 1;
      case 'completed':
        return 0;
      case 'hiatus':
        return 2;
      case 'cancelled':
        return 2;
      default:
        return undefined;
    }
  }

  private toManga(dto: MangaDto): Manga {
    const genreParts = [...(dto.genres ?? []), dto.type, dto.contentRating].filter(
      (g): g is string => !!g
    );
    return {
      title: dto.title,
      url: `/${MANGA_PATH}/${dto.slug}`,
      thumbnailUrl: dto.coverUrl ?? '',
      author: dto.authors?.join(', ') || undefined,
      artist: dto.artists?.join(', ') || undefined,
      description: dto.synopsis ?? undefined,
      genre: genreParts.join(', ') || undefined,
      status: this.toStatus(dto.status),
      lang: this.lang,
    };
  }

  private chapterName(dto: ChapterDto): string {
    const label = `Chapter ${dto.number.toString().replace(/\.0$/, '')}`;
    if (dto.title == null) return label;
    return /\d/.test(dto.title) ? dto.title : `${label} ${dto.title}`;
  }

  private toChapter(dto: ChapterDto, slug: string, seen: Set<number>): Chapter {
    const isDuplicate = seen.has(dto.number);
    seen.add(dto.number);
    const base = `/${MANGA_PATH}/${slug}`;
    const parsed = Date.parse(dto.createdAt);
    return {
      name: this.chapterName(dto),
      url: isDuplicate ? `${base}/${dto.id}#${dto.number}` : `${base}/${dto.number}`,
      chapterNumber: dto.number,
      dateUpload: Number.isNaN(parsed) ? undefined : parsed,
    };
  }

  private detailsInput(slug: string): Record<string, unknown> {
    return {
      0: { json: null, meta: { values: ['undefined'] } },
      1: { json: { slug } },
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.search(this.searchInput('', 'popular', page));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.search(this.searchInput('', 'recent', page));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.search(this.searchInput(query, 'relevance', page));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.getSlug(mangaUrl);
    if (!slug) return {};
    const data = (await this.apiGet(
      this.trpcUrl('auth.me,series.bySlugWithGenres', this.detailsInput(slug))
    )) as TrpcElement[];
    const dto = lastJson(data) as MangaDto | null;
    return dto ? { ...this.toManga(dto), url: mangaUrl } : {};
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.getSlug(mangaUrl);
    if (!slug) return [];
    const detailsData = (await this.apiGet(
      this.trpcUrl('auth.me,series.bySlugWithGenres', this.detailsInput(slug))
    )) as TrpcElement[];
    const manga = lastJson(detailsData) as MangaDto | null;
    if (!manga) return [];
    const data = (await this.apiGet(
      this.trpcUrl('auth.me,series.chapters', {
        0: { json: { values: ['undefined'] } },
        1: {
          json: { seriesId: manga.id, chapterId: null, sort: 'best', page: 1, limit: CHAPTER_LIMIT },
          meta: { values: { chapterId: ['undefined'] } },
        },
        2: { json: { seriesId: manga.id } },
      })
    )) as TrpcElement[];
    const chapters = lastJson(data) as ChapterDto[] | null;
    const seen = new Set<number>();
    return (chapters ?? []).map(ch => this.toChapter(ch, slug, seen));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = this.getSlug(chapterUrl);
    if (!slug) return [];
    const parts = chapterUrl.split('#');
    const numberPart = parts[1] ?? parts[0].split('/').filter(Boolean).pop() ?? '';
    const chapterNumber = parseFloat(numberPart) || 1;
    const data = (await this.apiGet(
      this.trpcUrl('auth.me,series.bySlug,reader.chapterPages', {
        0: { json: null, meta: { values: ['undefined'] } },
        1: { json: { slug } },
        2: { json: { seriesSlug: slug, chapterNumber } },
        3: { json: { position: 'footer_bottom' } },
      })
    )) as TrpcElement[];
    const pages = lastJson(data) as PageDto[] | null;
    return (pages ?? []).map(p => ({ index: p.pageOrder, imageUrl: p.avifUrl ?? p.webpUrl }));
  }
}