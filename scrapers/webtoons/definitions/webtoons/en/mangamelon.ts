import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface MangamelonMangaDto {
  id: string;
  title: string;
  cover?: string | null;
  desc?: string | null;
  status?: string | null;
  authors?: string | null;
  genres?: string[];
}

interface MangamelonChapterDto {
  id: string;
  title: string;
  seq: number;
  updated?: string | null;
}

interface MangamelonPageDto {
  url: string;
  seq: number;
}

interface MangaListRequest {
  search: string;
  genre: string;
  lang: string;
  sort: string;
  includeNsfw: boolean;
  limit: number;
  skip: number;
}

interface MangaGetRequest {
  target: string;
  withReviews: boolean;
}

interface ChapterListRequest {
  target: string;
  status: number;
  limit: number;
  skip: number;
  pending: string;
  force: boolean;
}

interface ChapterGetRequest {
  target: string;
  all: boolean;
}

interface MangaListResponse {
  list: MangamelonMangaDto[];
  total: number;
}

interface MangaGetResponse {
  manga: MangamelonMangaDto;
}

interface ChapterListResponse {
  chapters: MangamelonChapterDto[];
}

interface ChapterGetResponse {
  chapter: MangamelonChapterDto & { pages: MangamelonPageDto[] };
}

const API_BASE = 'https://api.mangamelon.com';
const PAGE_SIZE = 36;
const CHAPTER_LIMIT = 1000;

export class MangamelonScraper extends BaseScraper {
  readonly name = 'MangaMelon';
  readonly baseUrl = 'https://mangamelon.com';
  readonly lang = 'en';

  async getPopular(page: number): Promise<SearchResult> {
    return this.fetchMangaPage({ search: '', genre: '', sort: 'popular', page });
  }

  async getLatest(page: number): Promise<SearchResult> {
    return this.fetchMangaPage({ search: '', genre: '', sort: 'latest', page });
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    return this.fetchMangaPage({ search: query, genre: '', sort: 'latest', page });
  }

  private async fetchMangaPage(opts: { search: string; genre: string; sort: string; page: number }): Promise<SearchResult> {
    const skip = (opts.page - 1) * PAGE_SIZE;
    const body: MangaListRequest = {
      search: opts.search,
      genre: opts.genre,
      lang: this.lang,
      sort: opts.sort,
      includeNsfw: true,
      limit: PAGE_SIZE,
      skip,
    };
    const response = await this.api<MangaListResponse>('api/manga/list', body);
    const mangas = response.list.map(dto => this.toManga(dto));
    const hasNextPage = response.total > 0 ? skip + mangas.length < response.total : mangas.length >= PAGE_SIZE;
    return { mangas, hasNextPage };
  }

  private toManga(dto: MangamelonMangaDto): Manga {
    return {
      url: `/manga/${dto.id}`,
      title: dto.title,
      thumbnailUrl: dto.cover ?? '',
      description: dto.desc ?? undefined,
      author: dto.authors ?? undefined,
      genre: (dto.genres ?? []).join(', ') || undefined,
      status: this.toStatus(dto.status),
      lang: this.lang,
    };
  }

  private toStatus(status: string | null | undefined): MangaStatus {
    switch ((status ?? '').toLowerCase()) {
      case 'ongoing': return 1;
      case 'completed': return 0;
      case 'cancelled':
      case 'canceled': return 2;
      default: return 3;
    }
  }

  private mangaIdFromUrl(mangaUrl: string): string {
    return mangaUrl.replace(/^\//, '').split('/').pop() ?? '';
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const body: MangaGetRequest = { target: this.mangaIdFromUrl(mangaUrl), withReviews: false };
    const response = await this.api<MangaGetResponse>('api/manga/get', body);
    return this.toManga(response.manga);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const mangaId = this.mangaIdFromUrl(mangaUrl);
    const dtos: MangamelonChapterDto[] = [];
    let skip = 0;
    for (;;) {
      const body: ChapterListRequest = {
        target: mangaId,
        status: 0,
        limit: CHAPTER_LIMIT,
        skip,
        pending: '',
        force: true,
      };
      const response = await this.api<ChapterListResponse>('api/chapter/list', body);
      dtos.push(...response.chapters);
      if (response.chapters.length < CHAPTER_LIMIT) break;
      skip += response.chapters.length;
    }
    return dtos
      .sort((a, b) => b.seq - a.seq)
      .map(dto => ({
        url: `${mangaId}/${dto.id}`,
        name: dto.title,
        dateUpload: dto.updated && !dto.updated.startsWith('0001-')
          ? new Date(dto.updated).getTime()
          : undefined,
      }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.replace(/^\//, '').split('/').pop() ?? '';
    const body: ChapterGetRequest = { target: chapterId, all: true };
    const response = await this.api<ChapterGetResponse>('api/chapter/get', body);
    return response.chapter.pages
      .sort((a, b) => a.seq - b.seq)
      .map((dto, index) => ({ index, imageUrl: dto.url }));
  }

  private async api<T>(path: string, body: object): Promise<T> {
    const data = Buffer.from(JSON.stringify(body)).toString('base64');
    const form = new URLSearchParams({ data, sessionid: '' }).toString();
    const response = await this.post(`${API_BASE}/${path}`, form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data as T;
  }
}
