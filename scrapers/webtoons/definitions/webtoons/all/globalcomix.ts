import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const WEB_URL = 'https://globalcomix.com';
const WEB_COMIC_URL = `${WEB_URL}/c`;
const WEB_CHAPTER_URL = `${WEB_URL}/read`;
const API_URL = 'https://api.globalcomix.com/v1';
const API_MANGA_URL = `${API_URL}/read`;
const API_CHAPTER_URL = `${API_URL}/readV2`;
const API_SEARCH_URL = `${API_URL}/comics`;
const CLIENT_ID = 'gck_d0f170d5729446dcb3b55e6b3ebc7bf6';
const PREFIX_ID_SEARCH = 'id:';

interface PaginationState {
  page: number;
  per_page: number;
  total_pages: number;
  total_results: number;
}

interface PaginatedPayload<T> {
  results: T[];
  pagination: PaginationState;
}

interface PaginatedResponse<T> {
  payload?: PaginatedPayload<T>;
}

interface Payload<T> {
  results: T;
}

interface Response<T> {
  payload?: Payload<T>;
}

interface ArtistData {
  name: string;
  roman_name?: string;
}

interface MangaData {
  id?: number;
  name: string;
  description?: string;
  status_name?: string;
  category_name?: string;
  image_url?: string;
  artist: ArtistData;
}

interface ChapterData {
  title: string;
  chapter: string;
  key: string;
  premium_only?: number;
  published_time: string;
  page_objects?: PageData[];
}

interface PageData {
  is_page_paid: boolean;
  desktop_image_url: string;
  mobile_image_url: string;
}

function convertStatus(status: string): number {
  switch (status) {
    case 'Ongoing':
    case 'Preview':
      return 1;
    case 'Finished':
      return 1;
    case 'On hold':
      return 3;
    case 'Cancelled':
      return 5;
    default:
      return 0;
  }
}

function titleToSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

const LOCK_SYMBOL = '\uD83D\uDD12';

export class GlobalcomixScraper extends BaseScraper {
  readonly name = 'GlobalComix';
  readonly baseUrl = WEB_URL;
  readonly lang = 'all';

  private getHeaders(): Record<string, string> {
    return {
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
      'x-gc-client': CLIENT_ID,
      'x-gc-identmode': 'cookie',
    };
  }

  async getPopular(page: number): Promise<SearchResult> {
    const url = this.simpleQueryUrl(page, null, null);
    const res = await this.get(url, this.getHeaders());
    return this.mangaListParse(res);
  }

  async getLatest(page: number): Promise<SearchResult> {
    const url = this.simpleQueryUrl(page, 'recent', null);
    const res = await this.get(url, this.getHeaders());
    return this.mangaListParse(res);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const p = page ?? 1;
    if (query.startsWith('https://')) {
      const url = new URL(query);
      if (url.hostname !== new URL(this.baseUrl).hostname) {
        throw new Error('Unsupported url');
      }
      const titleId = url.pathname.split('/')[1];
      return this.getSearch(`${PREFIX_ID_SEARCH}${titleId}`, p);
    }
    if (query.startsWith(PREFIX_ID_SEARCH)) {
      const mangaSlugId = query.replace(PREFIX_ID_SEARCH, '');
      if (!mangaSlugId) throw new Error('Invalid manga id');
      const url = `${API_MANGA_URL}/${mangaSlugId}`;
      const res = await this.get(url, this.getHeaders());
      const dto = res.data as Response<MangaData>;
      const manga = dto.payload?.results;
      if (!manga) return { mangas: [], hasNextPage: false };
      return {
        mangas: [this.createManga(manga)],
        hasNextPage: false,
      };
    }
    const url = this.simpleQueryUrl(p, 'relevance', query);
    const res = await this.get(url, this.getHeaders());
    return this.mangaListParse(res);
  }

  async getMangaDetail(mangaUrl: string): Promise<Manga> {
    const url = `${API_MANGA_URL}/${titleToSlug(mangaUrl)}`;
    const res = await this.get(url, this.getHeaders());
    const dto = res.data as Response<MangaData>;
    return this.createManga(dto.payload!.results);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = `${API_SEARCH_URL}/${mangaUrl}/releases?lang_id=${this.lang}&all=true`;
    const res = await this.get(url, this.getHeaders());
    const dto = res.data as PaginatedResponse<ChapterData>;
    const chapters = dto.payload?.results ?? [];
    return chapters.map(c => this.createChapter(c)).filter(Boolean) as Chapter[];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = `${API_CHAPTER_URL}/${chapterUrl}`;
    const res = await this.get(url, this.getHeaders());
    const dto = res.data as Response<ChapterData>;
    const pages = dto.payload?.results?.page_objects ?? [];
    const chapterWebUrl = `${WEB_CHAPTER_URL}/${chapterUrl}`;
    return pages.map((p, index) => ({
      index,
      url: `${chapterWebUrl}/${index}`,
      imageUrl: p.desktop_image_url,
    }));
  }

  private simpleQueryUrl(page: number, orderBy: string | null, query: string | null): string {
    const url = new URL(API_SEARCH_URL);
    url.searchParams.set('lang_id[]', this.lang);
    url.searchParams.set('p', String(page));
    if (orderBy) url.searchParams.set('sort', orderBy);
    if (query) url.searchParams.set('q', query);
    return url.toString();
  }

  private async mangaListParse(res: any): Promise<SearchResult> {
    const url = res.url ?? res.config?.url ?? '';
    const isSingleItemLookup = url.toString().startsWith(API_MANGA_URL);
    const data = res.data;

    if (!isSingleItemLookup) {
      const dto = data as PaginatedResponse<MangaData>;
      const payload = dto.payload;
      if (!payload) return { mangas: [], hasNextPage: false };
      return {
        mangas: payload.results.map(m => this.createManga(m)),
        hasNextPage: payload.pagination.page < payload.pagination.total_pages,
      };
    } else {
      const dto = data as Response<MangaData>;
      return {
        mangas: dto.payload ? [this.createManga(dto.payload.results)] : [],
        hasNextPage: false,
      };
    }
  }

  private createManga(dto: MangaData): Manga {
    return {
      url: String(dto.id ?? ''),
      title: dto.name,
      description: dto.description,
      author: dto.artist?.roman_name ?? dto.artist?.name,
      status: dto.status_name ? convertStatus(dto.status_name) : 0,
      genres: dto.category_name,
      thumbnail: dto.image_url,
    };
  }

  private createChapter(dto: ChapterData): Chapter | null {
    const parts: string[] = [];
    if (dto.premium_only === 1) {
      parts.push(LOCK_SYMBOL);
    }
    if (dto.chapter) {
      parts.push(`Ch.${dto.chapter}`);
    }
    if (dto.title) {
      if (parts.length > 0) parts.push('-');
      parts.push(dto.title);
    }
    return {
      url: dto.key,
      name: parts.join(' '),
      chapterNumber: parseFloat(dto.chapter) || 0,
      date: this.parseDate(dto.published_time),
    };
  }

  private parseDate(dateStr: string): number {
    const ts = Date.parse(dateStr);
    return isNaN(ts) ? 0 : ts;
  }
}
