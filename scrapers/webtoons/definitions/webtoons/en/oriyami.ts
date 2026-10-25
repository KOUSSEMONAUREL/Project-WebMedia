import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.oriyami.com/api';
const PAGE_SIZE = 18;

interface OriyamiManga {
  title: string;
  slug: string;
  type?: string | null;
  cover_url?: string | null;
  status?: string | null;
  genres?: string[] | null;
  mangakas?: string[] | null;
  synopsis?: string | null;
  alternative_names?: string[] | null;
  demographic?: string | null;
  release_year?: number | null;
  avg_rating?: number | null;
  rating_count?: number | null;
  has_anime_adaptation?: boolean | null;
  scans?: OriyamiScan[];
}

interface OriyamiScan {
  number: string;
  kind: string;
  created_at: string;
  published_at?: string | null;
}

interface OriyamiPaged<T> {
  results: T[];
  has_next?: boolean;
  next?: string | null;
}

interface OriyamiChapterPages {
  pages: Array<{ image_url: string }>;
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status) {
    case 'Ongoing':
      return 1;
    case 'Completed':
      return 0;
    case 'Hiatus':
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

export class OriyamiScraper extends BaseScraper {
  readonly name = 'OriYami';
  readonly baseUrl = 'https://oriyami.com';
  readonly lang = 'en';

  private async api<T>(path: string): Promise<T> {
    const res = await this.get(`${API_URL}${path}`, {
      headers: { Accept: 'application/json' },
    });
    return res.data as T;
  }

  private toManga(item: OriyamiManga): Manga {
    const genres = [item.type, item.demographic, ...(item.genres ?? [])]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return {
      title: item.title,
      url: `/manga/${item.slug}`,
      thumbnailUrl: item.cover_url ?? '',
      lang: this.lang,
      author: item.mangakas?.join(', ') || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      status: parseStatus(item.status),
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const data = await this.api<OriyamiPaged<OriyamiManga>>(
      `/mangas/popular-list/?page=${page}&page_size=${PAGE_SIZE}`,
    );
    return { mangas: data.results.map(item => this.toManga(item)), hasNextPage: data.has_next === true };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const data = await this.api<OriyamiPaged<OriyamiManga>>(
      `/mangas/recently-updated/?page=${page}&page_size=${PAGE_SIZE}`,
    );
    return { mangas: data.results.map(item => this.toManga(item)), hasNextPage: data.has_next === true };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    if (query.trim()) params.set('q', query.trim());
    const data = await this.api<OriyamiPaged<OriyamiManga>>(
      `/mangas/browse/?${params.toString()}`,
    );
    return {
      mangas: data.results.map(item => this.toManga(item)),
      hasNextPage: data.next !== null && data.next !== undefined,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const item = await this.api<OriyamiManga>(`/mangas/${encodeURIComponent(slug)}/`);
    const info: string[] = [];
    if (item.rating_count && item.avg_rating) {
      info.push(`★ ${item.avg_rating.toFixed(1)} (${item.rating_count})`);
    }
    if (item.release_year) info.push(String(item.release_year));
    if (item.has_anime_adaptation) info.push('Has anime');
    const parts: string[] = [];
    if (info.length > 0) parts.push(info.join(' · '));
    if (item.synopsis?.trim()) parts.push(item.synopsis.trim());
    const altNames = (item.alternative_names ?? [])
      .map(name => name.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (altNames.length > 0) {
      parts.push(`**Alternative names:**\n${altNames.map(name => `- ${name}`).join('\n')}`);
    }
    return {
      ...this.toManga(item),
      url: mangaUrl,
      description: parts.join('\n\n').trim() || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const item = await this.api<OriyamiManga>(`/mangas/${encodeURIComponent(slug)}/`);
    return (item.scans ?? []).slice().reverse().map(scan => ({
      name: `${scan.kind} ${scan.number}`,
      url: `/manga/${slug}/${scan.kind.toLowerCase()}-${scan.number}`,
      dateUpload: parseDate(scan.published_at ?? scan.created_at),
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('/').filter(Boolean);
    const slug = parts[1] ?? '';
    const chapter = parts[2] ?? '';
    const number = chapter.slice(chapter.indexOf('-') + 1);
    const data = await this.api<OriyamiChapterPages>(
      `/mangas/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(number)}/`,
    );
    return (data.pages ?? []).map((page, index) => ({ index, imageUrl: page.image_url }));
  }
}

export default OriyamiScraper;
