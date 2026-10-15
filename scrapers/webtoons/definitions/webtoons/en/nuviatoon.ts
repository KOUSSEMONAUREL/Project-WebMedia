import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

// Transcompilation of keiyoushi `en/nuviatoon` after the 2026-10-15 upstream
// rewrite (issue #469): baseUrl moved `nuviatoon.com` -> `nuviatoon.net`
// (the old host returns 522), the catalogue moved
// `/nuvia-api/series` -> `/api/comics`, and the DTOs were restructured
// (`PaginatedResponse<SeriesDto>` -> `ComicsResponse`, `Meta{current_page,
// last_page}` -> `PageMeta{page, totalPages}`, series path `/series/<slug>`
// -> `/comics/<slug>`).
//
// Chapter identity changed too: the chapter id no longer travels in the URL
// query (`?id=`) but in upstream's `chapter.memo`; this port keeps the id in
// a `#<id>` URL fragment instead (same property, no extra field needed).
// Locked chapters (`priceCoins > 0`) are filtered out, mirroring upstream's
// `hideLockedChapters` default of true. Page images are signed R2 URLs —
// returned verbatim, never downloaded here.

interface PageMeta {
  page: number;
  totalPages: number;
}

interface ComicsResponse {
  data: ComicDto[];
  meta: PageMeta;
}

interface GenreDto {
  name: string;
}

interface ComicDto {
  slug: string;
  title: string;
  coverThumbUrl?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  seriesStatus?: string | null;
  genres?: GenreDto[] | null;
  chapters?: ChapterDto[] | null;
  altTitles?: string[] | null;
  ratingAvg?: number | null;
  ratingCount?: number | null;
}

interface DetailResponse {
  data: ComicDto;
}

interface ChapterDto {
  id: string;
  title?: string | null;
  number?: number | null;
  publishedAt?: string | null;
  priceCoins?: number | null;
}

interface ContentResponse {
  data: {
    pages: PageDto[];
  };
}

interface PageDto {
  index: number;
  url: string;
}

function parseStatus(status: string | null | undefined): 0 | 1 | 2 | 3 | undefined {
  switch (status?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 2;
    case 'hiatus': return 0;
    case 'dropped': return 3;
    default: return undefined;
  }
}

function comicToManga(dto: ComicDto): Manga {
  const parts: string[] = [];
  if (typeof dto.ratingCount === 'number' && dto.ratingCount > 0 && typeof dto.ratingAvg === 'number') {
    const avg = dto.ratingAvg.toFixed(1).replace(/\.0$/, '');
    parts.push(`Rating: ${avg}/5 (${dto.ratingCount} ratings)`);
  }
  if (dto.description) parts.push(dto.description);
  if (dto.altTitles && dto.altTitles.length > 0) {
    parts.push(`Associated Name(s):\n${dto.altTitles.map((t) => `- ${t}`).join('\n')}`);
  }
  const description = parts.join('\n\n').trim() || undefined;
  return {
    title: dto.title,
    url: dto.slug,
    thumbnailUrl: dto.coverUrl ?? dto.coverThumbUrl ?? '',
    author: dto.author ?? undefined,
    artist: dto.artist ?? undefined,
    description,
    genre: dto.genres?.map((g) => g.name).join(', ') ?? undefined,
    status: parseStatus(dto.seriesStatus),
    lang: 'en',
  };
}

function chapterToChapter(slug: string, dto: ChapterDto): Chapter | null {
  if ((dto.priceCoins ?? 0) > 0) return null;
  const numStr = dto.number != null ? String(dto.number).replace(/\.0$/, '') : '';
  const name = dto.title?.trim() ? dto.title.trim() : `Chapter ${numStr}`.trim();
  const dateUpload = dto.publishedAt ? Date.parse(dto.publishedAt) : Number.NaN;
  return {
    name,
    url: `${slug}/chapter/${numStr}#${dto.id}`,
    chapterNumber: dto.number ?? undefined,
    dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
  };
}

function asJson(data: unknown): unknown {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export class NuviatoonScraper extends BaseScraper {
  readonly name = 'Nuvia Toon';
  readonly baseUrl = 'https://nuviatoon.net';
  readonly lang = 'en';

  private async fetchComics(page: number, query: string | null, sort: string): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/comics`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', '18');
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('sort', sort);
    const res = await this.get(url.toString(), { headers: { Accept: 'application/json' } });
    const json = asJson(res.data) as ComicsResponse;
    const mangas = (json.data ?? []).map(comicToManga);
    const hasNextPage = json.meta ? json.meta.page < json.meta.totalPages : false;
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchComics(page, null, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.fetchComics(page, null, 'newest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.fetchComics(page, query || null, 'popular');
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop()?.split('#')[0] ?? '';
    const res = await this.get(`${this.baseUrl}/api/comics/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
    });
    const dto = (asJson(res.data) as DetailResponse).data;
    const m = comicToManga(dto);
    return { ...m, url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop()?.split('#')[0] ?? '';
    const res = await this.get(`${this.baseUrl}/api/comics/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
    });
    const dto = (asJson(res.data) as DetailResponse).data;
    return (dto.chapters ?? [])
      .map((c) => chapterToChapter(dto.slug || slug, c))
      .filter((c): c is Chapter => c !== null);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.split('#')[1]?.split('?')[0] ?? '';
    if (!id) return [];
    let res;
    try {
      res = await this.get(`${this.baseUrl}/api/comic-chapters/${encodeURIComponent(id)}/content`, {
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 402) {
        throw new Error('Log in via WebView and unlock this chapter with coins to read.');
      }
      throw err;
    }
    const data = (asJson(res.data) as ContentResponse).data;
    return [...(data.pages ?? [])]
      .sort((a, b) => a.index - b.index)
      .map((dto, index) => ({ index, imageUrl: dto.url }));
  }
}
