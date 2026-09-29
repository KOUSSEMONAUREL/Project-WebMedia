import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface SearchResponse {
  data: MangaDto[];
  pagination: SearchPagination;
}

interface SearchPagination {
  page: number;
  total_pages: number;
}

interface MangaDto {
  id: string;
  slug: string;
  name: string;
  image?: ImageDto | null;
}

interface TitleResponse {
  data: TitleDto;
}

interface TitleDto {
  id: string;
  slug: string;
  name: string;
  image?: ImageDto | null;
  description?: string[];
  alternateName?: string[];
  tags?: TagDto[];
  author?: AuthorDto[];
  status?: string | null;
}

interface ImageDto {
  file?: string | null;
  cdn_mangadex?: string | null;
  cdn_mangaupdate?: string | null;
  cdn_mangaupdates?: string | null;
  cover?: CoverDto | null;
}

interface CoverDto {
  path?: string | null;
}

interface TagDto {
  name: string;
}

interface AuthorDto {
  name: string;
}

interface ChapterListResponse {
  data: ChapterDto[];
}

interface ChapterDto {
  id: string;
  name?: string | null;
  number: number;
  volume?: number;
  lang: string;
  group?: GroupDto | null;
  created_at?: string | null;
}

interface GroupDto {
  name: string;
}

interface ChapterDetailResponse {
  data: {
    chapter: {
      title_id?: string | null;
      pages?: string[];
    };
  };
}

export interface MangaBallFilters {
  sortBy?: 'lastupdate' | 'views' | 'rating' | 'created_at' | 'name';
  sortOrder?: 'asc' | 'desc';
  tagMode?: 'AND' | 'OR';
  type?: '' | 'manga' | 'manhwa' | 'manhua' | 'comics';
  publicationDemographic?: '' | 'shounen' | 'shoujo' | 'seinen' | 'josei';
  status?: '' | 'ongoing' | 'completed' | 'hiatus' | 'cancelled';
  includedTags?: string[];
  excludedTags?: string[];
}

const COVER_BASE_URL = 'https://bulbasaur.poke-black-and-white.net/covers/';

const SCANLATOR_BLACKLIST: Set<string> = new Set();

function coverImageUrl(image: ImageDto | null | undefined): string {
  if (!image) return '';
  const rawPath = image.cover?.path?.trim().replace(/\\/g, '/');
  if (rawPath) {
    return rawPath.startsWith('http') ? rawPath : `${COVER_BASE_URL}${rawPath}`;
  }
  const fallback = [image.file, image.cdn_mangadex, image.cdn_mangaupdate, image.cdn_mangaupdates].find(
    (u) => u && u.trim().length > 0,
  );
  return fallback ?? '';
}

function parseUtcDateTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const hasOffset = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value.trim());
  const time = Date.parse(hasOffset ? value : `${value}Z`);
  return Number.isNaN(time) ? undefined : time;
}

function trimFloat(value: number): string {
  return String(value).replace(/\.0$/, '');
}

export class MangaBallScraper extends BaseScraper {
  readonly name = 'MangaBall';
  readonly baseUrl = 'https://mangaball.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchAdvanced(page, '', { sortBy: 'views', sortOrder: 'desc' });
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchAdvanced(page, '', { sortBy: 'lastupdate', sortOrder: 'desc' });
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const deepLink = await this.resolveDeepLink(query);
    if (deepLink) return deepLink;
    return this.searchAdvanced(page, query, {});
  }

  async searchAdvanced(page: number, keyword: string, filters: MangaBallFilters): Promise<SearchResult> {
    const response = await this.get('/api/v1/title/search-advanced', {
      params: {
        page,
        limit: 24,
        sort_by: filters.sortBy ?? 'lastupdate',
        sort_order: filters.sortOrder ?? 'desc',
        tag_mode: filters.tagMode ?? 'AND',
        adult_mode: 'all',
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.publicationDemographic ? { publicationDemographic: filters.publicationDemographic } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.includedTags?.length ? { included_tags: filters.includedTags.join(',') } : {}),
        ...(filters.excludedTags?.length ? { excluded_tags: filters.excludedTags.join(',') } : {}),
      },
    });
    const body = response.data as SearchResponse;
    return {
      mangas: (body.data ?? []).map((dto) => this.toManga(dto)),
      hasNextPage: (body.pagination?.page ?? page) < (body.pagination?.total_pages ?? page),
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.extractSlug(mangaUrl);
    const response = await this.get(`/api/v1/title/detail/${slug}`);
    const dto = (response.data as TitleResponse).data;
    const altNames = (dto.alternateName ?? []).map((n) => `- ${n}`).join('\n');
    const description = [dto.description?.join('\n\n') ?? '', altNames ? `Alternative Names: \n${altNames}` : '']
      .filter((part) => part.trim().length > 0)
      .join('\n\n')
      .trim();
    return {
      title: dto.name,
      url: `/title-detail/${dto.slug}`,
      thumbnailUrl: coverImageUrl(dto.image),
      lang: this.lang,
      author: (dto.author ?? []).map((a) => a.name).join(', ') || undefined,
      description: description || undefined,
      genre: (dto.tags ?? []).map((t) => t.name).join(', ') || undefined,
      status: this.toStatus(dto.status),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.extractSlug(mangaUrl);
    const details = await this.get(`/api/v1/title/detail/${slug}`);
    const titleId = (details.data as TitleResponse).data.id;
    const response = await this.post(
      '/api/v1/chapter/chapter-listing-by-title-id',
      { title_id: titleId },
      { headers: { 'Content-Type': 'application/json' } },
    );
    const chapters = ((response.data as ChapterListResponse).data ?? [])
      .map((dto) => this.toChapter(dto))
      .filter((c): c is Chapter => c !== null)
      .filter((c) => !SCANLATOR_BLACKLIST.has((c.scanlator ?? '').trim().toLowerCase()));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = this.extractChapterId(chapterUrl);
    const response = await this.get(`/api/v1/chapter-detail?chapter_id=${encodeURIComponent(chapterId)}`);
    const pages = (response.data as ChapterDetailResponse).data.chapter.pages ?? [];
    return pages.map((imageUrl, index) => ({ imageUrl, index }));
  }

  private toManga(dto: MangaDto): Manga {
    return {
      title: dto.name,
      url: `/title-detail/${dto.slug}`,
      thumbnailUrl: coverImageUrl(dto.image),
      lang: this.lang,
    };
  }

  private toStatus(status: string | null | undefined): Manga['status'] {
    switch (status) {
      case 'ongoing':
      case 'hiatus':
        return 1;
      case 'completed':
      case 'cancelled':
        return 2;
      default:
        return undefined;
    }
  }

  private toChapter(dto: ChapterDto): Chapter | null {
    const chapterName = (dto.name ?? '').trim();
    const numberStr = trimFloat(dto.number);
    const volume = dto.volume ?? 0;
    let name = '';
    if (volume > 0) name += `Vol. ${trimFloat(volume)} `;
    if (chapterName.includes(numberStr)) {
      name += chapterName;
    } else {
      name += `Ch. ${numberStr}`;
      if (chapterName) name += ` ${chapterName}`;
    }
    return {
      url: dto.id,
      name,
      chapterNumber: dto.number,
      scanlator: dto.group?.name,
      dateUpload: parseUtcDateTime(dto.created_at),
    };
  }

  private extractSlug(mangaUrl: string): string {
    const cleaned = mangaUrl.trim();
    const withoutHost = cleaned.replace(/^https?:\/\/[^/]+/i, '');
    const segments = withoutHost.split('/').filter(Boolean);
    if (segments[0] === 'title-detail' && segments[1]) return segments[1];
    return segments[segments.length - 1] ?? cleaned;
  }

  private extractChapterId(chapterUrl: string): string {
    const cleaned = chapterUrl.trim();
    const withoutHost = cleaned.replace(/^https?:\/\/[^/]+/i, '');
    const segments = withoutHost.split('/').filter(Boolean);
    if (segments[0] === 'chapter-detail' && segments[1]) return segments[1];
    return segments[segments.length - 1] ?? cleaned;
  }

  private async resolveDeepLink(query: string): Promise<SearchResult | null> {
    const trimmed = query.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.host !== 'mangaball.com' && url.host !== 'mangaball.net') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'title-detail' && segments[1]) {
      const details = await this.getMangaDetails(segments[1]);
      return {
        mangas: [
          {
            title: details.title ?? segments[1],
            url: `/title-detail/${segments[1]}`,
            thumbnailUrl: details.thumbnailUrl ?? '',
            lang: this.lang,
          },
        ],
        hasNextPage: false,
      };
    }
    if (segments[0] === 'chapter-detail' && segments[1]) {
      const response = await this.get(`/api/v1/chapter-detail?chapter_id=${encodeURIComponent(segments[1])}`);
      const titleId = (response.data as ChapterDetailResponse).data.chapter.title_id;
      if (!titleId) return null;
      const details = await this.getMangaDetails(titleId);
      return {
        mangas: [
          {
            title: details.title ?? titleId,
            url: details.url ?? `/title-detail/${titleId}`,
            thumbnailUrl: details.thumbnailUrl ?? '',
            lang: this.lang,
          },
        ],
        hasNextPage: false,
      };
    }
    return null;
  }
}
