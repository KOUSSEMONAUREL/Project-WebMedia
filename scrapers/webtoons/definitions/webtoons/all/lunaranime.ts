/**
 * Transcompilation of keiyoushi `all/lunaranime` (Lunar Manga).
 *
 * Catalogue/search/detail/chapters use the open JSON API at
 * `https://api.lunarx.to/api/manga`. The reader itself encrypts pages with
 * Turnstile + DPoP + AES (upstream `LunarSerenity.kt`/`LunarDecryptor.kt`), so
 * `getPageList` deliberately returns an empty list: the ingestion pipeline only
 * consumes `rootUrl` and never fetches page images.
 */
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.lunarx.to';

interface LunarMangaDto {
  slug: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  genres?: string | null;
  publication_status?: string | null;
  author?: string | null;
  artist?: string | null;
  alternative_titles?: string | null;
  demographic?: string | null;
  themes?: string | null;
}

interface LunarSearchResponse {
  manga?: LunarMangaDto[];
  page?: number;
  total_pages?: number;
}

interface LunarRecentResponse {
  our_mangas?: LunarMangaDto[];
  page?: number;
  limit?: number;
  total_count?: number;
}

interface LunarMangaResponse {
  manga: LunarMangaDto;
}

interface LunarChapterDto {
  chapter: string;
  chapter_number: number;
  chapter_title?: string | null;
  language: string;
  uploaded_at?: string | null;
}

interface LunarChapterListResponse {
  data?: LunarChapterDto[];
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing':
    case 'upcoming':
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

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [value];
  } catch {
    return [value];
  }
}

function toManga(item: LunarMangaDto): Manga {
  const altTitles = parseList(item.alternative_titles);
  const description = [item.description?.trim(), altTitles.length > 0 ? `Alternative Titles: ${altTitles.join(', ')}` : '']
    .filter(Boolean)
    .join('\n\n');
  const genres = [
    item.demographic?.trim() ? item.demographic.trim().charAt(0).toUpperCase() + item.demographic.trim().slice(1) : '',
    ...parseList(item.genres),
    ...parseList(item.themes),
  ].filter(Boolean);
  return {
    title: item.title,
    url: `/manga/${item.slug}`,
    thumbnailUrl: item.cover_url ?? '',
    lang: 'all',
    author: item.author?.trim() || undefined,
    artist: item.artist?.trim() || undefined,
    description: description || undefined,
    genre: [...new Set(genres)].join(', ') || undefined,
    status: parseStatus(item.publication_status),
  };
}

function chapterName(item: LunarChapterDto, locked = false): string {
  const number = item.chapter.replace(/\.00$/, '').replace(/\.0$/, '');
  const base = `Chapter ${number}`;
  const title = item.chapter_title?.trim() ?? '';
  if (!title) return `${locked ? '🔒 ' : ''}${base}`;
  const normalized = title.toLowerCase();
  if (
    normalized.includes(base.toLowerCase()) ||
    normalized.includes(`ch.${number.toLowerCase()}`) ||
    normalized.includes('volume') ||
    normalized.includes('vol.')
  ) {
    return `${locked ? '🔒 ' : ''}${title}`;
  }
  return `${locked ? '🔒 ' : ''}${base}: ${title}`;
}

export class LunaranimeScraper extends BaseScraper {
  readonly name = 'Lunar Manga';
  readonly baseUrl = 'https://lunarx.to';
  readonly lang = 'all';

  private async api<T>(path: string): Promise<T> {
    const res = await this.get(`${API_URL}${path}`, {
      headers: { Accept: 'application/json' },
    });
    return res.data as T;
  }

  private searchPath(query: string, page: number): string {
    const params = new URLSearchParams({
      page: String(page),
      limit: '30',
      sort: 'relevance',
    });
    if (query.trim()) params.set('query', query.trim());
    return `/api/manga/search?${params.toString()}`;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const data = await this.api<LunarSearchResponse>(this.searchPath('', page));
    return {
      mangas: (data.manga ?? []).map(toManga),
      hasNextPage: (data.page ?? 1) < (data.total_pages ?? 0),
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const data = await this.api<LunarRecentResponse>(`/api/manga/recent?page=${page}&limit=30`);
    return {
      mangas: (data.our_mangas ?? []).map(toManga),
      hasNextPage: (data.page ?? 1) * (data.limit ?? 30) < (data.total_count ?? 0),
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const data = await this.api<LunarSearchResponse>(this.searchPath(query, page));
    return {
      mangas: (data.manga ?? []).map(toManga),
      hasNextPage: (data.page ?? 1) < (data.total_pages ?? 0),
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const data = await this.api<LunarMangaResponse>(`/api/manga/title/${encodeURIComponent(slug)}`);
    return { ...toManga(data.manga), url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const data = await this.api<LunarChapterListResponse>(`/api/manga/${encodeURIComponent(slug)}`);
    return (data.data ?? [])
      .slice()
      .reverse()
      .map(item => ({
        name: chapterName(item),
        url: `/manga/${slug}/${encodeURIComponent(item.chapter)}?lang=${encodeURIComponent(item.language)}`,
        chapterNumber: Number(item.chapter) || item.chapter_number,
        scanlator: item.language.toUpperCase(),
        dateUpload: item.uploaded_at ? Date.parse(item.uploaded_at) || undefined : undefined,
      }));
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    // Chapter images need Turnstile + DPoP + AES (LunarSerenity/LunarDecryptor).
    // The pipeline stores one series URL per source and never reads page images.
    return [];
  }
}

export default LunaranimeScraper;
