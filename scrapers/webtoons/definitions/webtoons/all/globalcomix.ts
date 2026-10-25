import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.globalcomix.com/v1';
const CLIENT_ID = 'gck_d0f170d5729446dcb3b55e6b3ebc7bf6';

interface GlobalComixArtist {
  name?: string | null;
  roman_name?: string | null;
}

interface GlobalComixComic {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  status_name?: string | null;
  category_name?: string | null;
  image_url?: string | null;
  artist?: GlobalComixArtist | null;
}

interface GlobalComixRelease {
  chapter: string;
  title: string;
  key: string;
  premium_only?: number | null;
  published_time: string;
}

interface GlobalComixPagination {
  page?: number;
  total_pages?: number;
  has_next_page?: boolean;
}

interface GlobalComixListPayload {
  payload?: {
    results?: GlobalComixComic[];
    pagination?: GlobalComixPagination;
  };
}

interface GlobalComixDetailPayload {
  payload?: { results?: GlobalComixComic };
}

interface GlobalComixReleasesPayload {
  payload?: {
    results?: GlobalComixRelease[];
    pagination?: GlobalComixPagination;
  };
}

interface GlobalComixPagesPayload {
  payload?: {
    results?: {
      page_objects?: Array<{
        desktop_image_url?: string | null;
        mobile_image_url?: string | null;
      }>;
    };
  };
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status) {
    case 'Ongoing':
    case 'Preview':
      return 1;
    case 'Finished':
      return 0;
    case 'On hold':
      return 2;
    case 'Cancelled':
      return 2;
    default:
      return undefined;
  }
}

function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toManga(item: GlobalComixComic): Manga {
  return {
    title: item.name,
    url: `/c/${item.slug}`,
    thumbnailUrl: item.image_url ?? '',
    lang: 'all',
    author: item.artist?.roman_name ?? item.artist?.name ?? undefined,
    description: item.description ?? undefined,
    genre: item.category_name ?? undefined,
    status: parseStatus(item.status_name),
  };
}

export class GlobalcomixScraper extends BaseScraper {
  readonly name = 'GlobalComix';
  readonly baseUrl = 'https://globalcomix.com';
  readonly lang = 'all';

  private async api<T>(path: string): Promise<T> {
    const res = await this.get(`${API_URL}${path}`, {
      headers: {
        Accept: 'application/json',
        'x-gc-client': CLIENT_ID,
        'x-gc-identmode': 'cookie',
      },
    });
    return res.data as T;
  }

  private async browse(page: number, params: Record<string, string>): Promise<SearchResult> {
    const query = new URLSearchParams({ p: String(page), ...params });
    const data = await this.api<GlobalComixListPayload>(`/comics?${query.toString()}`);
    const results = data.payload?.results ?? [];
    const pagination = data.payload?.pagination;
    return {
      mangas: results.map(toManga),
      hasNextPage: (pagination?.page ?? page) < (pagination?.total_pages ?? 0),
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse(page, {});
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(page, { sort: 'recent' });
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.browse(page, { sort: 'relevance', q: query.trim() });
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const data = await this.api<GlobalComixDetailPayload>(`/read/${encodeURIComponent(slug)}`);
    const item = data.payload?.results;
    if (!item) return { url: mangaUrl, lang: this.lang };
    return { ...toManga(item), url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const detail = await this.api<GlobalComixDetailPayload>(`/read/${encodeURIComponent(slug)}`);
    const item = detail.payload?.results;
    if (!item) return [];
    const data = await this.api<GlobalComixReleasesPayload>(
      `/comics/${item.id}/releases?all=true`,
    );
    return (data.payload?.results ?? []).map(release => {
      const parts: string[] = [];
      if (release.premium_only === 1) parts.push('🔒');
      if (release.chapter) parts.push(`Ch.${release.chapter}`);
      if (release.title) {
        if (parts.length > 0) parts.push('-');
        parts.push(release.title);
      }
      return {
        name: parts.join(' '),
        url: `/read/${release.key}`,
        chapterNumber: Number.parseFloat(release.chapter) || undefined,
        dateUpload: parseDate(release.published_time),
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const key = chapterUrl.split('/').filter(Boolean).pop() ?? '';
    const data = await this.api<GlobalComixPagesPayload>(`/readV2/${encodeURIComponent(key)}`);
    return (data.payload?.results?.page_objects ?? [])
      .map(page => page.mobile_image_url ?? page.desktop_image_url ?? '')
      .filter(Boolean)
      .map((imageUrl, index) => ({ index, imageUrl }));
  }
}

export default GlobalcomixScraper;
