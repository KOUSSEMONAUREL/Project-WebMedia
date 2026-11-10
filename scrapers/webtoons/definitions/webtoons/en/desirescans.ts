import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Json } from '../../../engine/nextjs';

interface SeriesDto {
  urlSlug: string;
  title: string;
  coverImage?: string | null;
}

interface SeriesListDto {
  data: SeriesDto[];
  meta: { hasMore: boolean };
}

interface NameDto {
  name: string;
}

interface SeriesDetailsDto {
  title: string;
  altTitle?: string | null;
  originalTitle?: string | null;
  aliases?: string[];
  description?: string | null;
  coverImage?: string | null;
  status?: string | null;
  type?: string | null;
  origin?: string | null;
  genres?: NameDto[];
  tags?: NameDto[];
}

interface ChapterDto {
  number: number;
  title?: string | null;
  hasAccess?: boolean;
  publishedAt?: string | null;
}

interface SeriesPageDto {
  series: SeriesDetailsDto;
  chapters: ChapterDto[];
  totalPages: number;
}

interface PageDto {
  pageNumber: number;
  imageUrl: string;
  isRedacted?: boolean;
}

interface ChapterPagesDto {
  pages: PageDto[];
}

function parseStatus(value: string | null | undefined): MangaStatus {
  switch (value) {
    case 'ONGOING': return 1;
    case 'COMPLETED': return 0;
    case 'HIATUS': return 3;
    case 'DROPPED': return 2;
    default: return undefined;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function asSeriesList(value: unknown): SeriesListDto | null {
  if (!isJsonObject(value) || !Array.isArray(value.data) || !isJsonObject(value.meta)) return null;
  if (typeof value.meta.hasMore !== 'boolean') return null;
  return value as unknown as SeriesListDto;
}

function asSeriesPage(value: Json): SeriesPageDto | null {
  if (!isJsonObject(value) || !isJsonObject(value.series)) return null;
  if (!Array.isArray(value.chapters) || typeof value.totalPages !== 'number') return null;
  return value as unknown as SeriesPageDto;
}

function asChapterPages(value: Json): ChapterPagesDto | null {
  if (!isJsonObject(value) || !Array.isArray(value.pages)) return null;
  return value as unknown as ChapterPagesDto;
}

export class DesireScansScraper extends BaseScraper {
  override readonly name = 'DesireScans';
  override readonly baseUrl = 'https://desirescans.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSeries(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getSeries(page, 'updated');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.getSeries(page, undefined, query);
  }

  private async getSeries(page: number, sort?: string, query?: string): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/series`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '24');
    url.searchParams.set('contentMode', 'comics');
    if (sort) url.searchParams.set('sort', sort);
    const trimmed = query?.trim();
    if (trimmed) url.searchParams.set('q', trimmed);
    const response = await this.get(url.toString(), {
      headers: {
        Accept: 'application/json',
        Referer: `${this.baseUrl}/series`,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    const result = asSeriesList(response.data);
    if (!result) throw new Error('DesireScans: invalid series response');
    return {
      mangas: result.data.map(item => this.toManga(item)),
      hasNextPage: result.meta.hasMore,
    };
  }

  private toManga(item: SeriesDto): Manga {
    return {
      title: item.title,
      url: `${this.baseUrl}/series/comic/${item.urlSlug}`,
      thumbnailUrl: item.coverImage ? this.absUrl(item.coverImage) : '',
      lang: this.lang,
    };
  }

  private seriesSlug(mangaUrl: string): string {
    const path = /^https?:\/\//i.test(mangaUrl) ? new URL(mangaUrl).pathname : mangaUrl;
    const segments = path.split('/').filter(Boolean);
    if (segments[0] === 'series' && segments[1] === 'comic' && segments[2]) return segments[2];
    return segments[segments.length - 1] ?? '';
  }

  private async fetchSeriesPage(slug: string, page: number): Promise<SeriesPageDto> {
    const url = new URL(`${this.baseUrl}/series/comic/${encodeURIComponent(slug)}`);
    if (page > 1) url.searchParams.set('page', String(page));
    const response = await this.get(url.toString());
    const value = extractNextJsHtml(String(response.data), candidate => asSeriesPage(candidate) !== null);
    const result = value === null ? null : asSeriesPage(value);
    if (!result) throw new Error(`DesireScans: series page not found for ${slug}`);
    return result;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.seriesSlug(mangaUrl);
    if (!slug) return {};
    const page = await this.fetchSeriesPage(slug, 1);
    const series = page.series;
    const tags = (series.tags ?? []).map(tag => tag.name);
    const altTitles = [series.altTitle, series.originalTitle, ...(series.aliases ?? [])]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const parts: string[] = [];
    if (series.description) parts.push(series.description);
    if (series.type) parts.push(`Type: ${capitalize(series.type)}`);
    if (series.origin) parts.push(`Origin: ${capitalize(series.origin)}`);
    if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`);
    if (altTitles.length > 0) parts.push(`Alternative titles: ${altTitles.join(', ')}`);
    return {
      title: series.title,
      url: `${this.baseUrl}/series/comic/${slug}`,
      thumbnailUrl: series.coverImage ? this.absUrl(series.coverImage) : '',
      genre: (series.genres ?? []).map(genre => genre.name).join(', ') || undefined,
      description: parts.length > 0 ? parts.join('\n\n') : undefined,
      status: parseStatus(series.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.seriesSlug(mangaUrl);
    if (!slug) return [];
    const first = await this.fetchSeriesPage(slug, 1);
    const totalPages = Math.max(1, Math.trunc(first.totalPages));
    const rest = totalPages > 1
      ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => this.fetchSeriesPage(slug, index + 2)))
      : [];
    return [...first.chapters, ...rest.flatMap(page => page.chapters)]
      .map(chapter => this.toChapter(chapter, slug))
      .reverse();
  }

  private toChapter(chapter: ChapterDto, slug: string): Chapter {
    const numberText = String(chapter.number).replace(/\.0$/, '');
    const title = chapter.title?.replace(/\s+/g, ' ').trim();
    const name = title && title.length > 0 ? title : `Chapter ${numberText}`;
    const dateUpload = chapter.publishedAt ? Date.parse(chapter.publishedAt) : NaN;
    return {
      name: chapter.hasAccess === false ? `🔒 ${name}` : name,
      url: `${this.baseUrl}/series/comic/${slug}/chapter/${numberText}`,
      chapterNumber: Number.isFinite(chapter.number) ? chapter.number : undefined,
      dateUpload: Number.isFinite(dateUpload) ? dateUpload : undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const value = extractNextJsHtml(String(response.data), candidate => asChapterPages(candidate) !== null);
    const result = value === null ? null : asChapterPages(value);
    if (!result) return [];
    return result.pages
      .filter(page => !page.isRedacted && page.imageUrl.length > 0)
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page, index) => ({ index, imageUrl: page.imageUrl }));
  }
}
