import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface GenreDto {
  name?: string;
}

interface ComicDto {
  id?: string;
  title?: string;
  cover_image?: string | null;
  status?: string | null;
  type?: string | null;
  genres?: GenreDto[] | null;
}

interface ComicDetailDto extends ComicDto {
  alternative_titles?: string | null;
  synopsis?: string | null;
  author?: string | null;
  artist?: string | null;
  release_year?: string | null;
  chapters?: ChapterDto[];
  raw_chapters?: ChapterDto[];
}

interface ChapterDto {
  id?: string;
  chapter_number?: number;
  created_at?: string | null;
}

interface PageDto {
  image_url?: string;
  page_order?: number;
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing':
    case 'on-going': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    case 'cancelled':
    case 'canceled': return 2;
    default: return 3;
  }
}

function idFrom(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

export class ManhwaHScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor() {
    super();
    this.name = 'ManhwaH';
    this.baseUrl = 'https://manhwah.com';
    this.lang = 'en';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchComics(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchComics(page, 'latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.searchComics(page, 'popular', query);
  }

  private async searchComics(page: number, sort: string, query?: string): Promise<SearchResult> {
    const params = new URLSearchParams({
      page: String(page),
      limit: '24',
      sort,
    });
    if (query) params.set('search', query.trim());
    const res = await this.get(`${this.baseUrl}/api/comics?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const body = res.data as { data?: ComicDto[]; meta?: { page?: number; total_pages?: number } };
    const mangas = (body.data ?? []).map(dto => this.comicToManga(dto));
    return {
      mangas,
      hasNextPage: (body.meta?.page ?? 1) < (body.meta?.total_pages ?? 1),
    };
  }

  private comicToManga(dto: ComicDto): Manga {
    const id = dto.id ?? '';
    const genres = [
      dto.type,
      ...(dto.genres ?? []).map(genre => genre.name),
    ].filter((value): value is string => Boolean(value));
    return {
      title: dto.title ?? '',
      url: `${this.baseUrl}/title-detail/${id}`,
      thumbnailUrl: dto.cover_image ?? '',
      lang: this.lang,
      status: parseStatus(dto.status),
      genre: [...new Set(genres)].join(', ') || undefined,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const dto = await this.fetchComic(idFrom(mangaUrl));
    if (!dto) return {};
    const genres = [
      dto.type,
      ...(dto.genres ?? []).map(genre => genre.name),
    ].filter((value): value is string => Boolean(value));
    const altTitles = (dto.alternative_titles ?? '').split('|')
      .map(value => value.trim())
      .filter(value => value && value.toLowerCase() !== dto.title?.toLowerCase());
    const info = [dto.release_year ? `Release year: ${dto.release_year}` : ''].filter(Boolean);
    return {
      title: dto.title ?? '',
      url: mangaUrl,
      thumbnailUrl: dto.cover_image ?? '',
      lang: this.lang,
      author: dto.author && dto.author !== 'Updating' ? dto.author : undefined,
      artist: dto.artist && dto.artist !== 'Updating' ? dto.artist : undefined,
      status: parseStatus(dto.status),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: [
        dto.synopsis,
        info.join('\n'),
        altTitles.length > 0 ? `Alternative titles: ${altTitles.join(', ')}` : '',
      ].filter(Boolean).join('\n\n') || undefined,
    };
  }

  private async fetchComic(id: string): Promise<ComicDetailDto | null> {
    if (!id) return null;
    const res = await this.get(`${this.baseUrl}/api/comics/${id}`, {
      headers: { Accept: 'application/json' },
    });
    return (res.data as { data?: ComicDetailDto }).data ?? null;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const dto = await this.fetchComic(idFrom(mangaUrl));
    if (!dto) return [];
    const chapters = dto.chapters ?? [];
    const rawChapters = dto.raw_chapters ?? [];
    const source = chapters.length > 0 ? chapters : rawChapters;
    return source.map(chapter => this.chapterToChapter(chapter, chapters.length === 0))
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  private chapterToChapter(dto: ChapterDto, raw: boolean): Chapter {
    const number = dto.chapter_number;
    const createdAt = dto.created_at;
    const parsed = createdAt
      ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(createdAt) ? createdAt : `${createdAt}Z`).getTime()
      : NaN;
    return {
      name: `Chapter ${number !== undefined ? String(number).replace(/\.0$/, '') : ''}`.trim(),
      url: `${this.baseUrl}/chapter-detail/${dto.id ?? ''}`,
      chapterNumber: number,
      scanlator: raw ? 'Raw' : undefined,
      dateUpload: Number.isFinite(parsed) ? parsed : undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = idFrom(chapterUrl);
    const res = await this.get(`${this.baseUrl}/api/chapters/${id}`, {
      headers: { Accept: 'application/json' },
    });
    const dto = (res.data as { data?: { pages?: PageDto[] } }).data;
    return (dto?.pages ?? [])
      .slice()
      .sort((a, b) => (a.page_order ?? 0) - (b.page_order ?? 0))
      .map((page, index) => ({
        index,
        imageUrl: page.image_url ?? '',
      }));
  }
}
