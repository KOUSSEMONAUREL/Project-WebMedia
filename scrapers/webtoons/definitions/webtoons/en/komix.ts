import { BaseScraper } from '../../../engine/base';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject } from '../../../engine/nextjs';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

// Transcompilation of keiyoushi `en/komix` (Komix.kt + Dto.kt): the site
// now exposes its catalogue and series pages through JSON endpoints
// (`/api/page-data/browse`, `/api/page-data/title/<slug>`); the reader still
// hydrates from the RSC flight payload on the chapter page.

interface BrowseMangaDto {
  title: string;
  slug: string;
  cover_image?: string | null;
}

interface BrowseDto {
  results: BrowseMangaDto[];
  totalCount: number;
  page: number;
}

interface GenreDto {
  name: string;
}

interface ChapterDto {
  chapter_number: number;
  title: string;
  group?: string | null;
  created_at?: string | null;
  release_date?: string | null;
}

interface MangaDto {
  title: string;
  slug: string;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  cover_image?: string | null;
  genres?: GenreDto[] | null;
  alternative_titles?: string[] | null;
}

interface MangaPageDto {
  manga: MangaDto;
  chapters: ChapterDto[];
  jsonLd?: string | null;
}

interface ReaderPropsDto {
  chapter: {
    pages: { enc: string }[];
  };
}

function isBrowseDto(value: Json): boolean {
  return isJsonObject(value) && Array.isArray(value.results) && typeof value.totalCount === 'number';
}

function isMangaPageDto(value: Json): boolean {
  return isJsonObject(value) && isJsonObject(value.manga) && Array.isArray(value.chapters);
}

function isReaderPropsDto(value: Json): boolean {
  return isJsonObject(value) && isJsonObject(value.chapter) && Array.isArray((value.chapter as JsonObject).pages);
}

function resolveUrl(base: string, ref: string | null | undefined): string {
  if (!ref) return '';
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function parseStatus(status: string | null | undefined): 0 | 1 | 2 | 3 | undefined {
  switch (status) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 0;
    case 'cancelled':
    case 'dropped': return 2;
    default: return undefined;
  }
}

function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

export class KomixScraper extends BaseScraper {
  readonly name = 'Komix';
  readonly baseUrl = 'https://komix.to';
  readonly lang = 'en';

  private toManga(dto: BrowseMangaDto): Manga {
    return {
      title: dto.title.trim(),
      url: dto.slug,
      thumbnailUrl: resolveUrl(this.baseUrl, dto.cover_image),
      lang: this.lang,
    };
  }

  private slugFrom(mangaUrl: string): string {
    const trimmed = mangaUrl.split('?')[0];
    const parts = trimmed.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? trimmed;
  }

  private async browse(page: number, query: string, sort: string): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/page-data/browse`);
    if (query.trim()) url.searchParams.set('q', query.trim());
    url.searchParams.set('sort', sort);
    url.searchParams.set('order', 'desc');
    if (page > 1) url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as BrowseDto;
    const mangas = (data.results ?? []).map((item) => this.toManga(item));
    const currentPage = data.page ?? page;
    return { mangas, hasNextPage: currentPage * 60 < data.totalCount };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse(page, '', 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(page, '', 'date');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.browse(page, query, 'relevance');
  }

  private mangaPageToManga(dto: MangaDto, synopsis: string | undefined): Manga {
    const parts: string[] = [];
    if (synopsis?.trim()) parts.push(synopsis.trim());
    const altTitles = (dto.alternative_titles ?? []).map((t) => t.trim()).filter(Boolean);
    if (altTitles.length > 0) parts.push(`Alternative titles:\n${altTitles.map((t) => `- ${t}`).join('\n')}`);
    const genre = [
      ...((dto.genres ?? []).map((g) => g.name)),
    ].filter((g, i, arr) => g && arr.indexOf(g) === i);
    return {
      title: dto.title.trim(),
      url: dto.slug,
      thumbnailUrl: resolveUrl(this.baseUrl, dto.cover_image),
      author: dto.author ?? undefined,
      artist: dto.artist ?? undefined,
      description: parts.join('\n\n').trim() || undefined,
      genre: genre.length > 0 ? genre.join(', ') : undefined,
      status: parseStatus(dto.status),
      lang: this.lang,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`${this.baseUrl}/api/page-data/title/${encodeURIComponent(slug)}`);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as MangaPageDto;
    let synopsis: string | undefined;
    try {
      if (data.jsonLd) {
        const parsed = JSON.parse(data.jsonLd) as { '@graph'?: { '@type'?: string; description?: string }[] };
        synopsis = parsed['@graph']?.find((n) => n['@type'] === 'Book')?.description ?? undefined;
      }
    } catch {
      synopsis = undefined;
    }
    const m = this.mangaPageToManga(data.manga, synopsis);
    return { ...m, url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`${this.baseUrl}/api/page-data/title/${encodeURIComponent(slug)}`);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as MangaPageDto;
    if (!data) return [];
    return (data.chapters ?? []).map((c) => {
      const numStr = String(c.chapter_number).replace(/\.0$/, '');
      const url = new URL(`${this.baseUrl}/title/${data.manga.slug}/chapter/${numStr}`);
      if (c.group) url.searchParams.set('group', c.group);
      const stamp = Date.parse(c.release_date ?? c.created_at ?? '');
      return {
        name: c.title,
        url: url.pathname + (url.search || ''),
        chapterNumber: c.chapter_number,
        scanlator: c.group && c.group !== '(none)' ? c.group : undefined,
        dateUpload: Number.isNaN(stamp) ? undefined : stamp,
      } as Chapter;
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const html = res.data as string;
    const dto = extractNextJsHtml(html, isReaderPropsDto) as unknown as ReaderPropsDto | null;
    if (!dto) return [];
    return (dto.chapter.pages ?? []).map((page, index) => {
      const url = new URL(`${this.baseUrl}/api/images`);
      url.searchParams.set('t', page.enc);
      return { index, imageUrl: url.toString() };
    });
  }
}

export default KomixScraper;
