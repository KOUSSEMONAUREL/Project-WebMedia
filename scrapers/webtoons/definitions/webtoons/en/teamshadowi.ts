import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { JsonObject, NextJsPredicate } from '../../../engine/nextjs';

interface SeriesDto {
  id: string;
  title: string;
  slug: string;
  thumbnail_url?: string | null;
  status?: string | null;
  description?: string | null;
  genres?: string[] | null;
}

interface SeriesResponse {
  data: SeriesDto[];
  hasMore: boolean;
}

interface SearchResponse {
  series: SeriesDto[];
}

interface SeriesDetails {
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  status?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
}

interface ChapterData {
  id: string;
  number: number | string;
  title?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
}

interface PublicDataSeries {
  series: SeriesDetails;
  chapters: ChapterData[];
}

interface PublicDataChapter {
  pages: string[];
}

function toManga(dto: SeriesDto): Manga {
  const status = dto.status?.toLowerCase() === 'ongoing' ? 1 : dto.status?.toLowerCase() === 'completed' ? 0 : undefined;
  return {
    title: dto.title,
    url: `/series/${dto.slug}`,
    thumbnailUrl: dto.thumbnail_url ?? '',
    description: dto.description ?? undefined,
    genre: dto.genres?.join(', ') || undefined,
    status,
    lang: 'en',
  };
}

const SERIES_PREDICATE: NextJsPredicate = value => isJsonObject(value) && 'series' in value && 'chapters' in value;
const PAGES_PREDICATE: NextJsPredicate = value => isJsonObject(value) && 'pages' in value;

export class TeamshadowiScraper extends BaseScraper {
  readonly name = 'Team Shadowi';
  readonly baseUrl = 'https://www.team-shadowi.com';
  readonly lang = 'en';

  private async fetchRsc(url: string, predicate: NextJsPredicate): Promise<JsonObject | null> {
    const res = await this.get(url, { headers: { Rsc: '1' } });
    const ct = String(res.headers['content-type'] ?? '');
    const value = ct.includes('text/html')
      ? extractNextJsHtml(String(res.data), predicate)
      : extractNextJsRsc(String(res.data), predicate);
    return isJsonObject(value) ? value : null;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * 20;
    const res = await this.get(`${this.baseUrl}/api/series/popular?timePeriod=all&genre=all&sortBy=rating&offset=${offset}&limit=20`);
    const body = res.data as SeriesResponse;
    const mangas = (body.data ?? []).map(toManga);
    return { mangas, hasNextPage: body.hasMore ?? false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * 20;
    const res = await this.get(`${this.baseUrl}/api/series/popular?timePeriod=all&genre=all&sortBy=created&offset=${offset}&limit=20`);
    const body = res.data as SeriesResponse;
    const mangas = (body.data ?? []).map(toManga);
    return { mangas, hasNextPage: body.hasMore ?? false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query) {
      const url = new URL(`${this.baseUrl}/api/search`);
      url.searchParams.set('q', query);
      const res = await this.get(url.toString());
      const body = res.data as SearchResponse;
      const mangas = (body.series ?? []).map(toManga);
      return { mangas, hasNextPage: false };
    }
    const offset = (page - 1) * 20;
    const url = new URL(`${this.baseUrl}/api/series/popular`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', '20');
    url.searchParams.set('timePeriod', 'all');
    url.searchParams.set('genre', 'all');
    url.searchParams.set('sortBy', 'rating');
    const res = await this.get(url.toString());
    const body = res.data as SeriesResponse;
    const mangas = (body.data ?? []).map(toManga);
    return { mangas, hasNextPage: body.hasMore ?? false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const dto = await this.fetchRsc(`${this.baseUrl}/series/${slug}`, SERIES_PREDICATE);
    if (!dto) return { url: mangaUrl, lang: this.lang };
    const series = isJsonObject(dto.series) ? dto.series as unknown as SeriesDetails : null;
    if (!series) return { url: mangaUrl, lang: this.lang };
    const status = series.status?.toLowerCase() === 'ongoing' ? 1 : series.status?.toLowerCase() === 'completed' ? 0 : undefined;
    const genres = [...(series.genres ?? []), ...(series.tags ?? [])].filter(s => s.length > 0).join(', ') || undefined;
    return {
      title: series.title,
      url: `/series/${slug}`,
      thumbnailUrl: series.thumbnail_url ?? '',
      description: series.description ?? undefined,
      status,
      genre: genres,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    const dto = await this.fetchRsc(`${this.baseUrl}/series/${slug}`, SERIES_PREDICATE);
    if (!dto || !Array.isArray(dto.chapters)) return [];
    const raw = dto.chapters as unknown as ChapterData[];
    const chapters = raw.filter(c => c && c.number !== null && c.number !== undefined);
    return chapters.map(ch => {
      const num = typeof ch.number === 'string' ? parseFloat(ch.number) : ch.number;
      const numStr = String(num).replace(/\.0$/, '');
      const name = ch.title ? `Chapter ${numStr}: ${ch.title}` : `Chapter ${numStr}`;
      const dateStr = ch.created_at ?? ch.createdAt;
      const parsed = dateStr ? Date.parse(dateStr) : NaN;
      return {
        name,
        url: `/read/${slug}/${numStr}`,
        chapterNumber: num,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    }).sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const dto = await this.fetchRsc(this.absUrl(chapterUrl), PAGES_PREDICATE);
    if (!dto || !Array.isArray(dto.pages)) return [];
    const pages = dto.pages as unknown as string[];
    return pages.map((url, index) => ({ index, imageUrl: url }));
  }
}
