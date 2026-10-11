import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/paradisescans`
 * (ParadiseScans.kt + Dto.kt).
 *
 * Pure JSON API, no HTML scraping:
 * - Popular: `GET /api/series?sort=sales&dir=desc&per_page=12&page=N`
 * - Latest: `GET /api/series?sort=latest_chapter&per_page=12&page=N`
 * - Search: `GET /api/series?per_page=12&page=N&q=<query>`
 * - Details: `GET /api/series/<slug>`; chapters:
 *   `GET /api/series/<slug>/chapters` (locked/premium/early-access entries
 *   hidden, mirroring the Kt default `showLockedChapters = false`); pages:
 *   `GET /api/chapters/<id>/pages` sorted by `page_number`.
 *
 * Series URL format: `/series/<slug>` (upstream deeplink `/series/..*`).
 * Chapter URLs keep the site's reader shape `/series/<slug>/chapter/<number>`
 * so entries stay valid; `getPageList` re-resolves the chapter id through the
 * chapters endpoint (the engine's `Chapter` carries no memo field) and then
 * hits the pages endpoint, resolving relative `image_url`s against `baseUrl`.
 *
 * Verified live 2026-10-11 (`curl -4`): `/api/series` 200 with 315 total
 * (`meta.current_page/last_page`), `/api/series/<slug>` 200,
 * `/chapters` 200 (chapter 1..N with `number`/`created_at`), `/pages` 200
 * (`page_number` + relative `/storage/import/…` URLs).
 */

interface ApiMeta {
  current_page: number;
  last_page: number;
}

interface SeriesListResponse {
  data: SeriesDto[];
  meta?: ApiMeta | null;
}

interface SeriesDto {
  title: string;
  slug: string;
  cover_url?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres: string[];
}

interface ChapterDto {
  id: string;
  number?: number | null;
  title?: string | null;
  price?: number | null;
  is_premium?: boolean;
  early_access?: boolean;
  early_locked?: boolean;
  created_at?: string | null;
}

interface PageDto {
  page_number: number;
  image_url: string;
}

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) as T : data as T);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

export class ParadiseScansScraper extends BaseScraper {
  readonly name = 'Paradise Scans';
  readonly baseUrl = 'https://paradisescans.com';
  readonly lang = 'en';

  private toManga(series: SeriesDto): Manga {
    return {
      title: series.title,
      url: `/series/${series.slug}`,
      thumbnailUrl: series.cover_url ? this.absUrl(series.cover_url) : '',
      lang: this.lang,
    };
  }

  private async fetchSeriesList(url: string): Promise<SearchResult> {
    const res = await this.get(url);
    const body = parseJson<SeriesListResponse>(res.data);
    const current = body.meta?.current_page ?? 1;
    const last = body.meta?.last_page ?? 1;
    return { mangas: body.data.map((series) => this.toManga(series)), hasNextPage: current < last };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchSeriesList(`/api/series?sort=sales&dir=desc&per_page=12&page=${page}`);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.fetchSeriesList(`/api/series?sort=latest_chapter&per_page=12&page=${page}`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({ per_page: '12', page: String(page) });
    if (query.trim()) params.set('q', query.trim());
    return this.fetchSeriesList(`/api/series?${params.toString()}`);
  }

  private slugFromUrl(mangaUrl: string): string {
    const parts = mangaUrl.split('/').filter(Boolean);
    const seriesIndex = parts.indexOf('series');
    if (seriesIndex >= 0 && parts[seriesIndex + 1]) return parts[seriesIndex + 1];
    return parts[parts.length - 1] ?? '';
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFromUrl(mangaUrl);
    const res = await this.get(`/api/series/${slug}`);
    const series = parseJson<SeriesDto>(res.data);
    const status = (series.status ?? '').toLowerCase();
    return {
      title: series.title,
      url: `/series/${series.slug}`,
      thumbnailUrl: series.cover_url ? this.absUrl(series.cover_url) : '',
      description: series.description ?? undefined,
      author: series.author ?? undefined,
      artist: series.artist ?? series.author ?? undefined,
      genre: series.genres.length > 0 ? series.genres.join(', ') : undefined,
      status: status === 'ongoing' ? 1
        : status === 'completed' ? 0
        : status === 'hiatus' ? 3
        : status === 'cancelled' ? 2
        : undefined,
      lang: this.lang,
    };
  }

  private isLocked(chapter: ChapterDto): boolean {
    return (chapter.price != null && chapter.price > 0)
      || chapter.is_premium === true
      || chapter.early_access === true
      || chapter.early_locked === true;
  }

  private async fetchChapterDtos(slug: string): Promise<ChapterDto[]> {
    const res = await this.get(`/api/series/${slug}/chapters`);
    return parseJson<ChapterDto[]>(res.data);
  }

  private toChapter(slug: string, chapter: ChapterDto): Chapter {
    const number = chapter.number != null ? formatNumber(chapter.number) : null;
    const title = chapter.title?.trim() ?? '';
    const name = number !== null
      ? (title === '' || title === number || /^chapter\b/i.test(title) ? `Chapter ${number}` : `Chapter ${number} - ${title}`)
      : (title || 'Chapter');
    const parsed = chapter.created_at ? Date.parse(chapter.created_at) : NaN;
    return {
      name,
      url: number !== null ? `/series/${slug}/chapter/${number}` : chapter.id,
      chapterNumber: chapter.number ?? undefined,
      dateUpload: Number.isNaN(parsed) ? undefined : parsed,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    const chapters = await this.fetchChapterDtos(slug);
    return chapters
      .filter((chapter) => !this.isLocked(chapter))
      .sort((a, b) => (b.number ?? 0) - (a.number ?? 0))
      .map((chapter) => this.toChapter(slug, chapter));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('/').filter(Boolean);
    const chapterIndex = parts.indexOf('chapter');
    const slugIndex = parts.indexOf('series');
    const slug = slugIndex >= 0 ? parts[slugIndex + 1] ?? '' : '';
    const number = chapterIndex >= 0 ? parts[chapterIndex + 1] ?? '' : '';
    const chapters = await this.fetchChapterDtos(slug);
    const match = chapters.find((chapter) =>
      chapter.number != null && formatNumber(chapter.number) === number,
    ) ?? chapters[0];
    if (!match) return [];
    const res = await this.get(`/api/chapters/${match.id}/pages`);
    const pages = parseJson<PageDto[]>(res.data).sort((a, b) => a.page_number - b.page_number);
    return pages.map((page, index) => ({ index, imageUrl: this.absUrl(page.image_url) }));
  }
}

export default ParadiseScansScraper;
