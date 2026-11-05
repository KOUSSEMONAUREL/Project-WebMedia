import { BaseScraper } from '../../../engine/base';
import { extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject } from '../../../engine/nextjs';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface TitleDto {
  id?: string;
  title?: string;
  coverNormal?: string | null;
  author?: string | null;
  tags?: string[];
  status?: string | null;
}

interface UploadDto {
  id?: string;
  datetime?: string | null;
  sourceName?: string;
}

interface ChapterDto {
  id?: string;
  number?: string;
  title?: string;
  datetime?: string | null;
  sources?: UploadDto[];
}

interface DetailDto extends TitleDto {
  alternativeNames?: string[];
  artist?: string | null;
  keywords?: string[];
  type?: string | null;
  released?: string | null;
  officialTranslation?: boolean;
  animeAdaptation?: boolean;
  description?: string | null;
  chapters?: ChapterDto[];
}

interface ReaderDto {
  seriesTitle?: string;
  seriesCover?: string | null;
  seriesId?: string;
  pages?: string[];
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing': return 1;
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

export class BaetoonScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor() {
    super();
    this.name = 'Baetoon';
    this.baseUrl = 'https://baetoon.com';
    this.lang = 'en';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchTitles(page, 'most-view');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchTitles(page, 'lastest-updates');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.searchTitles(page, 'most-view', query);
  }

  private async searchTitles(page: number, sort: string, query?: string): Promise<SearchResult> {
    const params = new URLSearchParams({
      sort,
      page: String(page),
      limit: '24',
    });
    if (query) params.set('text', query.trim());
    const res = await this.get(`${this.baseUrl}/api/titles/search?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        Referer: `${this.baseUrl}/advanced-search`,
      },
    });
    const body = res.data as {
      data?: TitleDto[];
      pagination?: { page?: number; totalPages?: number };
    };
    return {
      mangas: (body.data ?? []).map(dto => this.titleToManga(dto)),
      hasNextPage: (body.pagination?.page ?? 1) < (body.pagination?.totalPages ?? 1),
    };
  }

  private titleToManga(dto: TitleDto): Manga {
    return {
      title: dto.title ?? '',
      url: `${this.baseUrl}/title-detail/${dto.id ?? ''}`,
      thumbnailUrl: dto.coverNormal ?? '',
      lang: this.lang,
      author: dto.author && dto.author !== 'Korean Creator' && dto.author !== 'Korean Studio'
        ? dto.author
        : undefined,
      genre: (dto.tags ?? []).join(', ') || undefined,
      status: parseStatus(dto.status),
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const dto = await this.fetchDetail(idFrom(mangaUrl));
    if (!dto) return {};
    const genres = [
      dto.type,
      ...(dto.tags ?? []),
      ...(dto.keywords ?? []),
    ].filter((value): value is string => Boolean(value));
    const altTitles = (dto.alternativeNames ?? []).filter(title => title !== dto.title);
    const info = [
      dto.released && /^\d{4}$/.test(dto.released) ? `Released: ${dto.released}` : '',
      dto.officialTranslation ? 'Official translation' : '',
      dto.animeAdaptation ? 'Anime adaptation' : '',
    ].filter(Boolean);
    return {
      title: dto.title ?? '',
      url: mangaUrl,
      thumbnailUrl: dto.coverNormal ?? '',
      lang: this.lang,
      author: dto.author && dto.author !== 'Korean Creator' && dto.author !== 'Korean Studio'
        ? dto.author
        : undefined,
      artist: dto.artist && dto.artist !== 'Korean Creator' && dto.artist !== 'Korean Studio'
        ? dto.artist
        : undefined,
      status: parseStatus(dto.status),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: [
        info.join('\n'),
        dto.description,
        altTitles.length > 0 ? `Alternative titles: ${altTitles.join(', ')}` : '',
      ].filter(Boolean).join('\n\n') || undefined,
    };
  }

  private async fetchDetail(id: string): Promise<DetailDto | null> {
    if (!id) return null;
    const value = await this.fetchRsc(`${this.baseUrl}/title-detail/${id}`, object =>
      isJsonObject(object) && Array.isArray(object.chapters) && typeof object.title === 'string');
    return value && isJsonObject(value) ? value as unknown as DetailDto : null;
  }

  private async fetchRsc(path: string, predicate: (value: Json) => boolean): Promise<Json | null> {
    const url = new URL(path);
    url.searchParams.set('_rsc', '');
    const res = await this.get(url.toString(), {
      headers: {
        rsc: '1',
        Accept: 'text/x-component',
      },
    });
    return extractNextJsRsc(String(res.data), predicate);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const dto = await this.fetchDetail(idFrom(mangaUrl));
    if (!dto) return [];
    const chapters: Chapter[] = [];
    for (const chapter of dto.chapters ?? []) {
      const uploads = (chapter.sources ?? []).filter((upload, index, all) =>
        upload.sourceName && all.findIndex(candidate => candidate.sourceName === upload.sourceName) === index);
      if (uploads.length === 0) {
        chapters.push(this.uploadToChapter(chapter, { id: chapter.id, datetime: chapter.datetime }));
        continue;
      }
      for (const upload of uploads) {
        chapters.push(this.uploadToChapter(chapter, upload));
      }
    }
    return chapters;
  }

  private uploadToChapter(chapter: ChapterDto, upload: UploadDto): Chapter {
    const number = Number.parseFloat(chapter.number ?? '');
    const date = upload.datetime ?? chapter.datetime;
    const parsed = date ? new Date(date).getTime() : NaN;
    return {
      name: chapter.title ?? `Chapter ${chapter.number ?? ''}`,
      url: `${this.baseUrl}/chapter-detail/${upload.id ?? ''}`,
      chapterNumber: Number.isFinite(number) ? number : undefined,
      scanlator: upload.sourceName,
      dateUpload: Number.isFinite(parsed) ? parsed : undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = idFrom(chapterUrl);
    const value = await this.fetchRsc(`${this.baseUrl}/chapter-detail/${id}`, object =>
      isJsonObject(object) && Array.isArray(object.pages) && typeof object.seriesTitle === 'string');
    const dto = value && isJsonObject(value) ? value as unknown as ReaderDto : null;
    return (dto?.pages ?? []).map((imageUrl, index) => ({ index, imageUrl }));
  }
}
