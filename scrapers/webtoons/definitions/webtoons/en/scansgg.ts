import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.scans.gg';
const CDN_URL = 'https://cdn.scans.gg/uploads';

interface ResponseDto<T> {
  data: T;
  meta?: { has_more: boolean };
}

interface SeriesDto {
  id: number;
  title: string;
  summary?: string | null;
  cover?: string | null;
  author?: string[] | null;
  artist?: string[] | null;
  tags?: number[] | null;
  status?: number | null;
}

interface ChapterDto {
  id: number;
  number: number;
  title?: string | null;
  created_at?: string | null;
  group_id?: number | null;
  group?: { title?: string | null } | null;
}

interface PageListDto {
  chapter?: { id?: number | null; pages?: { position: number; path: string }[] | null } | null;
}

function toManga(dto: SeriesDto, cdnUrl: string): Manga {
  return {
    title: dto.title,
    url: String(dto.id),
    thumbnailUrl: dto.cover ? `${cdnUrl}/covers/${dto.cover}` : '',
    lang: 'en',
  };
}

function toMangaDetailed(dto: SeriesDto, cdnUrl: string): Partial<Manga> {
  const statusMap: Record<number, Manga['status']> = {
    1: 1,
    2: 0,
    3: 2,
    4: 2,
    5: 2,
  };
  return {
    title: dto.title,
    url: String(dto.id),
    thumbnailUrl: dto.cover ? `${cdnUrl}/covers/${dto.cover}` : '',
    description: dto.summary ?? undefined,
    author: dto.author?.join(', ') || undefined,
    artist: dto.artist?.join(', ') || undefined,
    status: dto.status !== null && dto.status !== undefined ? statusMap[dto.status] : undefined,
    lang: 'en',
  };
}

function toChapter(dto: ChapterDto, seriesId: string): Chapter {
  const numStr = dto.number.toString().replace(/\.0$/, '');
  const name = dto.title ? `Chapter ${numStr} - ${dto.title}` : `Chapter ${numStr}`;
  const parsed = dto.created_at ? Date.parse(dto.created_at) : NaN;
  return {
    name,
    url: `/chapter-navigation?series_id=${seriesId}&chapter_id=${dto.id}&group_id=${dto.group_id ?? 0}`,
    chapterNumber: dto.number,
    scanlator: dto.group?.title ?? undefined,
    dateUpload: Number.isNaN(parsed) ? undefined : parsed,
  };
}

export class ScansggScraper extends BaseScraper {
  readonly name = 'ScansGG';
  readonly baseUrl = 'https://scans.gg';
  readonly lang = 'en';
  private readonly apiUrl = API_URL;
  private readonly cdnUrl = CDN_URL;

  async getPopular(page = 1): Promise<SearchResult> {
    const limit = 21;
    const offset = (page - 1) * limit;
    const url = `${this.apiUrl}/series?limit=${limit}&offset=${offset}`;
    const res = await this.get(url);
    const dto = res.data as ResponseDto<SeriesDto[]>;
    const mangas = (dto.data ?? []).map(d => toManga(d, this.cdnUrl));
    return { mangas, hasNextPage: mangas.length === limit };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const limit = 14;
    const url = `${this.apiUrl}/chapters?page=${page}&limit=${limit}&chapters=true&series_details=true&group_details=true&sort=date`;
    const res = await this.get(url);
    const dto = res.data as ResponseDto<SeriesDto[]>;
    const mangas = (dto.data ?? []).map(d => toManga(d, this.cdnUrl));
    return { mangas, hasNextPage: dto.meta?.has_more ?? false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const limit = 21;
    const offset = (page - 1) * limit;
    const url = new URL(`${this.apiUrl}/series`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('q_type', '[]');
    url.searchParams.set('q_status', '[]');
    url.searchParams.set('q_tags', '[]');
    const res = await this.get(url.toString());
    const dto = res.data as ResponseDto<SeriesDto[]>;
    const mangas = (dto.data ?? []).map(d => toManga(d, this.cdnUrl));
    return { mangas, hasNextPage: mangas.length === limit };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const url = `${this.apiUrl}/series?id=${encodeURIComponent(id)}&trackers=true&sources=true`;
    const res = await this.get(url);
    const dto = res.data as ResponseDto<SeriesDto>;
    return toMangaDetailed(dto.data, this.cdnUrl);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const chapters: Chapter[] = [];
    let page = 1;
    let hasMore = true;
    const limit = 100;
    while (hasMore) {
      const url = `${this.apiUrl}/chapters?series_id=${encodeURIComponent(id)}&limit=${limit}&page=${page}&group_details=true`;
      const res = await this.get(url);
      const dto = res.data as ResponseDto<ChapterDto[]>;
      chapters.push(...(dto.data ?? []).map(d => toChapter(d, id)));
      hasMore = dto.meta?.has_more ?? false;
      page++;
      if (page > 5) break;
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = this.apiUrl + chapterUrl;
    const res = await this.get(url);
    const dto = res.data as ResponseDto<PageListDto>;
    const chapter = dto.data.chapter;
    const pages = chapter?.pages ?? [];
    return pages.map(p => ({
      index: p.position,
      imageUrl: `${this.cdnUrl}/pages/${chapter?.id}/${p.path}`,
    }));
  }
}
