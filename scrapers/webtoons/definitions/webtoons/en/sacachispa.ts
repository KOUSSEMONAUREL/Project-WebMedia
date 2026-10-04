import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/sacachispa` (Sacachispa.kt + Dto.kt).
 *
 * The site is a JSON backend: `api.sacachispa.site`. Covers are relative
 * paths served by `cdn.sacachispa.site`, hence `toCoverUrl`.
 *
 * Chapter gating: `/releases/<id>/pages` answers 403 with a JSON body for
 * Patreon-exclusive chapters, and the message is worth surfacing as-is
 * instead of a bare HTTP error.
 */

const API_URL = 'https://api.sacachispa.site/api';
const CDN_URL = 'https://cdn.sacachispa.site';
const PAGE_SIZE = 24;
const CHAPTER_PAGE_SIZE = 500;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PaginationDto {
  page: number;
  pages: number;
}

interface NamedDto {
  name: string;
}

interface MangaListDto {
  id: string;
  slug: string;
  title: string;
  cover?: string | null;
}

interface MangaDetailDto {
  id: string;
  slug: string;
  title: string;
  status: string;
  authors?: NamedDto[];
  artists?: NamedDto[];
  genres?: NamedDto[];
  covers?: { image: string }[];
  synopses?: { synopsis: string }[];
}

interface ChapterRefDto {
  chapter: string;
  title?: string | null;
  patreonOnly?: boolean | null;
}

interface ReleaseDto {
  id: string;
  chapter: ChapterRefDto;
  publishedAt: string;
}

export class SacachispaScraper extends BaseScraper {
  readonly name = 'Sacachispa';
  readonly baseUrl = 'https://sacachispa.site';
  readonly lang = 'en';

  private async fetchList(page: number, endpoint: string, query?: string): Promise<SearchResult> {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (query) params.set('q', query);
    const res = await this.get(`${endpoint}?${params.toString()}`);
    const body = res.data as { data: MangaListDto[]; pagination: PaginationDto };
    const mangas: Manga[] = (body.data ?? []).map(dto => ({
      title: dto.title,
      // The id is the stable key: the slug is only cosmetic, and releases are
      // keyed by the UUID.
      url: `/manga/${dto.id}/${dto.slug}`,
      thumbnailUrl: dto.cover ? this.toCoverUrl(dto.cover) : '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: body.pagination.page < body.pagination.pages };
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    return this.fetchList(page, `${API_URL}/manga`);
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error('getLatest is not supported by Sacachispa');
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    return this.fetchList(page, `${API_URL}/manga/search`, query.trim());
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.mangaIdFromUrl(mangaUrl);
    const res = await this.get(`${API_URL}/manga/${id}`);
    const dto = (res.data as { data: MangaDetailDto }).data;
    const cover = dto.covers?.[0]?.image;
    return {
      title: dto.title,
      url: `/manga/${dto.id}/${dto.slug}`,
      thumbnailUrl: cover ? this.toCoverUrl(cover) : '',
      description: dto.synopses?.[0]?.synopsis ?? undefined,
      author: (dto.authors ?? []).map(a => a.name).join(', ') || undefined,
      artist: (dto.artists ?? []).map(a => a.name).join(', ') || undefined,
      genre: (dto.genres ?? []).map(g => g.name).join(', ') || undefined,
      status: this.toStatus(dto.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const mangaId = await this.resolveMangaId(this.mangaIdFromUrl(mangaUrl));
    const chapters: Chapter[] = [];
    let page = 1;
    let lastPage: number;
    do {
      const res = await this.get(
        `${API_URL}/releases?mangaId=${mangaId}&page=${page}&limit=${CHAPTER_PAGE_SIZE}`,
      );
      const body = res.data as { data: ReleaseDto[]; pagination: PaginationDto };
      for (const dto of body.data ?? []) {
        const title = dto.chapter?.title?.trim();
        const locked = dto.chapter?.patreonOnly === true;
        chapters.push({
          name: `${locked ? '🔒 ' : ''}Chapter ${dto.chapter?.chapter ?? ''}${title ? ` - ${title}` : ''}`,
          url: `/read/${dto.id}`,
          chapterNumber: this.toChapterNumber(dto.chapter?.chapter),
          dateUpload: dto.publishedAt ? Date.parse(dto.publishedAt) : undefined,
        });
      }
      lastPage = body.pagination.pages;
      page += 1;
    } while (page <= lastPage);
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const releaseId = chapterUrl.split('/').filter(Boolean).pop() ?? '';
    let res;
    try {
      res = await this.get(`${API_URL}/releases/${releaseId}/pages`);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      if (status === 403 && message) throw new Error(message);
      throw err;
    }
    const items = (res.data as { data?: { items?: { url: string }[] } })?.data?.items ?? [];
    return items.map((item, index) => ({ index, imageUrl: item.url }));
  }

  private mangaIdFromUrl(mangaUrl: string): string {
    const segments = mangaUrl.split('/').filter(Boolean);
    const afterManga = segments[segments.indexOf('manga') + 1];
    return afterManga ?? segments[segments.length - 1] ?? '';
  }

  private async resolveMangaId(idOrSlug: string): Promise<string> {
    if (UUID_REGEX.test(idOrSlug)) return idOrSlug;
    const res = await this.get(`${API_URL}/manga/${idOrSlug}`);
    return (res.data as { data: { id: string } }).data.id;
  }

  private toCoverUrl(value: string): string {
    return value.startsWith('http') ? value : `${CDN_URL}/${value.replace(/^\/+/, '')}`;
  }

  private toStatus(value: string): Manga['status'] {
    switch (value) {
      case 'ONGOING':
        return 1;
      case 'COMPLETED':
        return 0;
      case 'HIATUS':
        return 2;
      case 'DROPPED':
        return 3;
      default:
        return undefined;
    }
  }

  /** Faithful to upstream `toFloatOrNull() ?: -1f`: the whole string must parse. */
  private toChapterNumber(label: string | null | undefined): number {
    const trimmed = (label ?? '').trim();
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return -1;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? -1 : parsed;
  }
}