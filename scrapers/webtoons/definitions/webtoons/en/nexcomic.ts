import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';
import { extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json } from '../../../engine/nextjs';

// Transcompilation of keiyoushi `en/nexcomic` (NexComic.kt + Dto.kt).
// The catalogue is a local JSON API (`/api/local/*`) and the series/chapter
// payloads are React Server Components responses served at `<page>.rsc`.

interface SeriesDto {
  slug: string;
  title: string;
  type?: string | null;
  status?: string | null;
  description?: string | null;
  alternativeTitles?: string[];
  genres?: string[];
  tags?: string[];
  authors?: string[];
  artists?: string[];
  avatar?: { url?: string | null } | null;
}

interface SeriesListDto {
  data: SeriesDto[];
}

interface PopularEntryDto {
  slug: string;
}

interface PopularDto {
  data: PopularEntryDto[];
}

interface ChapterDto {
  id: string;
  seriesSlug: string;
  chapterNumber: number;
  title?: string | null;
  locked?: boolean;
  publishedAt?: number | null;
}

interface CatalogDto {
  series: SeriesDto[];
  chapters: ChapterDto[];
}

interface PageDto {
  pageNumber: number;
  url: string;
}

interface ChapterPagesDto {
  pages: PageDto[];
}

function parseStatus(value: string | null | undefined): MangaStatus {
  switch (value?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    case 'cancelled':
    case 'canceled':
    case 'dropped': return 2;
    default: return undefined;
  }
}

function asCatalog(value: Json): CatalogDto | null {
  if (!isJsonObject(value) || !Array.isArray(value.series) || !Array.isArray(value.chapters)) return null;
  return value as unknown as CatalogDto;
}

function asChapterPages(value: Json): ChapterPagesDto | null {
  if (!isJsonObject(value) || !('chapterNumber' in value) || !Array.isArray(value.pages) || value.pages.length === 0) {
    return null;
  }
  return value as unknown as ChapterPagesDto;
}

export class NexComicScraper extends BaseScraper {
  readonly name = 'NexComic';
  readonly baseUrl = 'https://nexcomic.com';
  readonly lang = 'en';

  private seriesSlug(mangaUrl: string): string {
    const after = mangaUrl.split('/series/')[1];
    const raw = after ?? mangaUrl.split('/').filter(Boolean).pop() ?? '';
    return raw.split(/[/#?]/)[0];
  }

  private chapterIdSuffix(id: string): string {
    const index = id.indexOf(':');
    return index >= 0 ? id.slice(index + 1) : id;
  }

  private chapterPath(chapter: ChapterDto): string {
    return `/series/${chapter.seriesSlug}/chapter/${this.chapterIdSuffix(chapter.id)}`;
  }

  private toManga(item: SeriesDto): Manga {
    return {
      title: item.title,
      url: `/series/${item.slug}`,
      thumbnailUrl: item.avatar?.url ? this.absUrl(item.avatar.url) : '',
      author: item.authors?.join(', ') || undefined,
      artist: item.artists?.join(', ') || undefined,
      genre: [
        ...(item.type ? [item.type] : []),
        ...(item.genres ?? []),
        ...(item.tags ?? []),
      ].join(', ') || undefined,
      status: parseStatus(item.status),
      lang: this.lang,
    };
  }

  private async getAllSeries(): Promise<SeriesDto[]> {
    const res = await this.get('/api/local/series', { headers: { Accept: 'application/json' } });
    return (res.data as SeriesListDto).data ?? [];
  }

  private async popularRank(): Promise<Map<string, number>> {
    const res = await this.get('/api/local/popular?limit=100&period=all', {
      headers: { Accept: 'application/json' },
    });
    const data = (res.data as PopularDto).data ?? [];
    return new Map(data.map((entry, index) => [entry.slug, index]));
  }

  private async sortedByPopular(series: SeriesDto[]): Promise<SeriesDto[]> {
    const rank = await this.popularRank();
    const fallback = Number.MAX_SAFE_INTEGER;
    return series
      .slice()
      .sort((a, b) => (rank.get(a.slug) ?? fallback) - (rank.get(b.slug) ?? fallback));
  }

  private async getCatalog(slug: string): Promise<CatalogDto | null> {
    const res = await this.get(`/series/${encodeURIComponent(slug)}.rsc`, {
      headers: { Accept: 'text/x-component' },
    });
    const value = extractNextJsRsc(String(res.data), candidate => asCatalog(candidate) !== null);
    return value === null ? null : asCatalog(value);
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const series = await this.sortedByPopular(await this.getAllSeries());
    return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const series = await this.getAllSeries();
    return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    const series = await this.getAllSeries();
    const filtered = term
      ? series.filter(item =>
        [item.title, ...(item.alternativeTitles ?? [])].some(title => title.toLowerCase().includes(term)),
      )
      : series;
    const sorted = await this.sortedByPopular(filtered);
    return { mangas: sorted.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.seriesSlug(mangaUrl);
    if (!slug) return { url: mangaUrl, lang: this.lang };
    const catalog = await this.getCatalog(slug);
    const item = catalog?.series.find(series => series.slug === slug);
    if (!item) return { url: `/series/${slug}`, lang: this.lang };
    return {
      ...this.toManga(item),
      url: `/series/${slug}`,
      description: item.description?.replace(/<[^>]*>/g, '').trim() || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.seriesSlug(mangaUrl);
    if (!slug) return [];
    const catalog = await this.getCatalog(slug);
    if (!catalog) return [];
    return catalog.chapters
      .filter(chapter => chapter.seriesSlug === slug && !chapter.locked)
      .map(chapter => ({
        name: `Chapter ${chapter.chapterNumber}${chapter.title?.trim() ? ` - ${chapter.title.trim()}` : ''}`,
        url: this.chapterPath(chapter),
        chapterNumber: Number.isFinite(chapter.chapterNumber) ? chapter.chapterNumber : undefined,
        dateUpload: chapter.publishedAt || undefined,
      }))
      .sort((a, b) => (b.chapterNumber ?? -1) - (a.chapterNumber ?? -1));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = this.absUrl(chapterUrl).replace(/\.rsc$/, '');
    const res = await this.get(`${url}.rsc`, { headers: { Accept: 'text/x-component' } });
    const value = extractNextJsRsc(String(res.data), candidate => asChapterPages(candidate) !== null);
    const pages = value === null ? null : asChapterPages(value);
    if (!pages) return [];
    return pages.pages
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page, index) => ({
        index,
        imageUrl: this.absUrl(page.url),
      }));
  }
}

export default NexComicScraper;
