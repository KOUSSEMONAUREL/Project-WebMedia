import { BaseScraper } from '../../../engine/base';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const API_PATH = '/api/balcony-api-v2';
const PAGE_SIZE = 30;
const BALCONY_ID = 'LEZHIN_ES';

interface ApiResult<T> {
  result?: string;
  data: T;
}

interface ThumbnailDto {
  imagePath: string;
  type: string;
}

interface ListItemDto {
  id: number;
  alias: string;
  title: string;
  creators?: string | null;
  thumbnails?: ThumbnailDto[];
}

interface CreatorDto {
  name: string;
  type: string;
}

interface TagDto {
  name: string;
}

interface ContentDto {
  id: number;
  alias: string;
  title: string;
  creators?: CreatorDto[];
  tags?: TagDto[];
  synopsis?: string | null;
  status?: string | null;
  thumbnails?: ThumbnailDto[];
}

interface SearchDto {
  contents: ListItemDto[];
  hasNext: boolean;
  nextPagination?: string | null;
}

interface EpisodeDto {
  alias: string;
  title: string;
  subTitle?: string | null;
  openedAt?: number;
  possessionCoin?: number;
  eventPossessionCoin?: number | null;
  purchaseStatus?: string | null;
}

interface SeriesPageDto {
  ssrDetail?: {
    episodes?: EpisodeDto[];
  } | null;
}

interface ViewerPageDto {
  episodeData?: {
    result?: {
      images?: { imagePath: string }[];
    } | null;
    error?: {
      code?: string;
    } | null;
  } | null;
}

function cover(thumbnails: ThumbnailDto[] | undefined): string {
  const list = thumbnails ?? [];
  return (list.find(t => t.type === 'MAIN') ?? list.find(t => t.type === 'VERTICAL') ?? list[0])?.imagePath ?? '';
}

function isPaid(episode: EpisodeDto): boolean {
  const coins = episode.eventPossessionCoin ?? episode.possessionCoin ?? 0;
  return coins > 0 && (episode.purchaseStatus == null || episode.purchaseStatus === 'NONE');
}

export class LezhinScraper extends BaseScraper {
  readonly name = 'Lezhin';
  readonly baseUrl = 'https://www.lezhin.es';
  readonly lang = 'all';

  private searchCursor: string | null = null;
  private searchKey = '';

  private get apiHeaders(): Record<string, string> {
    return {
      'x-balcony-id': BALCONY_ID,
      'x-platform': 'WEB',
      Accept: 'application/json',
    };
  }

  private toManga(dto: ListItemDto): Manga {
    return {
      title: dto.title,
      url: `/detail/${dto.alias}`,
      thumbnailUrl: cover(dto.thumbnails),
      author: dto.creators || undefined,
      lang: this.lang,
    };
  }

  private async browseIds(sort: string): Promise<number[]> {
    const params = new URLSearchParams({ adultToggle: 'false', sort });
    const res = await this.get(`${API_PATH}/contents/tab/genre/COMIC?${params.toString()}`, {
      headers: this.apiHeaders,
    });
    return (res.data as ApiResult<number[]>).data ?? [];
  }

  private async browse(page: number, sort: string): Promise<SearchResult> {
    const ids = await this.browseIds(sort);
    const pageIds = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (pageIds.length === 0) return { mangas: [], hasNextPage: false };
    const res = await this.post(
      `${API_PATH}/contents/tab/details`,
      {
        contentsIds: pageIds.join(','),
        contentsThumbnailType: 'MAIN',
        contentsType: 'COMIC',
      },
      { headers: this.apiHeaders },
    );
    const cards = (res.data as ApiResult<ListItemDto[]>).data ?? [];
    return {
      mangas: cards.map(card => this.toManga(card)),
      hasNextPage: page * PAGE_SIZE < ids.length,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse(page, 'POPULAR');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(page, 'LATEST');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const q = query.trim();
    if (!q) return this.getPopular(page);
    if (page <= 1 || this.searchKey !== q) {
      this.searchCursor = null;
      this.searchKey = q;
    }
    const params = new URLSearchParams({
      searchText: q,
      isIncludeAdult: 'true',
      page: Math.max(0, page - 1).toString(),
      size: PAGE_SIZE.toString(),
      isCheckDevice: 'true',
      contentsThumbnailType: 'MAIN',
      searchMethod: 'click',
      sort: 'POPULAR',
    });
    let url = `${API_PATH}/search/all?${params.toString()}`;
    if (this.searchCursor) url += `&nextPagination=${this.searchCursor}`;
    const res = await this.get(url, { headers: this.apiHeaders });
    const data = (res.data as ApiResult<SearchDto>).data;
    this.searchCursor = data?.nextPagination ?? null;
    return {
      mangas: (data?.contents ?? []).map(item => this.toManga(item)),
      hasNextPage: data?.hasNext ?? false,
    };
  }

  private alias(mangaUrl: string): string {
    try {
      const segments = new URL(mangaUrl, this.baseUrl).pathname.split('/').filter(Boolean);
      if (segments.length >= 2 && (segments[0] === 'detail' || segments[0] === 'viewer')) return segments[1];
      return segments[0] ?? '';
    } catch {
      return '';
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const alias = this.alias(mangaUrl);
    if (!alias) return {};
    const params = new URLSearchParams({ isNotLoginAdult: 'false', isPorch: 'false' });
    const res = await this.get(`${API_PATH}/contents/${encodeURIComponent(alias)}?${params.toString()}`, {
      headers: this.apiHeaders,
    });
    const dto = (res.data as ApiResult<ContentDto | null>).data;
    if (!dto) return {};
    const creators = dto.creators ?? [];
    return {
      title: dto.title,
      url: `/detail/${dto.alias}`,
      thumbnailUrl: cover(dto.thumbnails),
      author: creators.filter(c => c.type !== 'ARTIST').map(c => c.name).join(', ') || undefined,
      artist: creators.filter(c => c.type === 'ARTIST').map(c => c.name).join(', ') || undefined,
      genre: (dto.tags ?? []).map(t => t.name).join(', ') || undefined,
      description: dto.synopsis ?? undefined,
      status: this.toStatus(dto.status),
      lang: this.lang,
    };
  }

  private toStatus(status: string | null | undefined): MangaStatus {
    switch (status) {
      case 'SCHEDULED':
        return 1;
      case 'COMPLETED':
        return 0;
      case 'PAUSED':
        return 2;
      default:
        return 3;
    }
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const alias = this.alias(mangaUrl);
    if (!alias) return [];
    const res = await this.get(`/detail/${encodeURIComponent(alias)}`);
    const page = extractNextJsHtml(res.data as string, v => isJsonObject(v) && 'ssrDetail' in v) as SeriesPageDto | null;
    const episodes = page?.ssrDetail?.episodes ?? [];
    return episodes.map(episode => {
      const label = episode.title + (episode.subTitle ? ` - ${episode.subTitle}` : '');
      return {
        name: isPaid(episode) ? `\u{1F512} ${label}` : label,
        url: `${alias}/${episode.alias}`,
        dateUpload: episode.openedAt || undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`/viewer/${chapterUrl}`);
    const page = extractNextJsHtml(res.data as string, v => isJsonObject(v) && 'episodeData' in v) as ViewerPageDto | null;
    const data = page?.episodeData;
    const images = data?.result?.images;
    if (!images) {
      throw new Error(`Lezhin: episode unavailable (${data?.error?.code ?? 'UNKNOWN'})`);
    }
    return images.map((image, index) => ({ index, imageUrl: image.imagePath }));
  }
}
