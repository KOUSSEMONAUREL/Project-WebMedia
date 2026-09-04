import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const IMG_API_URL = 'https://xz7.fstr-cdn.com';
const PAGE_SIZE = 24;

interface MangaDto {
  slug: string;
  english_title?: string | null;
  japanese_title?: string | null;
  title: string;
  cover?: string | null;
}

interface ListResponse {
  data: MangaDto[];
}

interface MangaDetailsDto {
  slug: string;
  english_title?: string | null;
  japanese_title?: string | null;
  title: string;
  cover?: string | null;
  synopsis?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: string | null;
  tags?: string | null;
  status?: string | null;
}

interface DetailsResponse {
  manga: MangaDetailsDto;
  chapters: ChapterDto[];
}

interface ChapterDto {
  id: number;
  chapter_number?: string | null;
  volume?: number | null;
  title?: string | null;
  source?: string | null;
  published_at?: string | null;
}

interface PageListResponse {
  pages: string[];
}

function toManga(dto: MangaDto, useEnglish: boolean): Manga {
  const title = useEnglish
    ? (dto.english_title && dto.english_title.length > 0 ? dto.english_title : dto.title)
    : (dto.japanese_title && dto.japanese_title.length > 0 ? dto.japanese_title : dto.title);
  return {
    title,
    url: dto.slug,
    thumbnailUrl: dto.cover ? `${IMG_API_URL}${dto.cover}` : '',
    lang: 'en',
  };
}

function parseStatus(status?: string | null): Manga['status'] {
  switch (status?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 2;
    case 'cancelled': return 2;
    default: return undefined;
  }
}

function parseArrayString(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {}
  return [];
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
}

export class MangaunoScraper extends BaseScraper {
  readonly name = 'Manga.uno';
  readonly baseUrl = 'https://manga.uno';
  readonly lang = 'en';
  private readonly apiUrl = 'https://manga.uno/api';
  private readonly useEnglishTitle = true;

  private toDetailsManga(dto: MangaDetailsDto): Partial<Manga> {
    const title = this.useEnglishTitle
      ? (dto.english_title && dto.english_title.length > 0 ? dto.english_title : dto.title)
      : (dto.japanese_title && dto.japanese_title.length > 0 ? dto.japanese_title : dto.title);
    const genres = parseArrayString(dto.genres);
    const tags = parseArrayString(dto.tags);
    const genre = [...genres, ...tags].filter(s => s.length > 0).join(', ') || undefined;
    return {
      title,
      url: dto.slug,
      thumbnailUrl: dto.cover ? `${IMG_API_URL}${dto.cover}` : '',
      description: dto.synopsis ?? undefined,
      author: dto.author?.replace(' & ', ', ') || undefined,
      artist: dto.artist?.replace(' & ', ', ') || undefined,
      genre,
      status: parseStatus(dto.status),
      lang: this.lang,
    };
  }

  private toChapter(dto: ChapterDto, mangaSlug: string): Chapter {
    const chStr = dto.chapter_number ? parseFloat(dto.chapter_number).toString().replace(/\.0$/, '') : '';
    const chLabel = chStr ? `Ch. ${chStr}` : '';
    const volStr = dto.volume !== null && dto.volume !== undefined ? `Vol. ${dto.volume}` : '';
    const title = dto.title ? unescapeHtml(dto.title) : '';
    const parts = [chLabel, volStr, title].filter(s => s.length > 0);
    const name = parts.join(' — ') || 'Chapter';
    const parsed = dto.published_at ? Date.parse(dto.published_at) : NaN;
    return {
      name,
      url: `${mangaSlug}/${dto.id}`,
      chapterNumber: chStr ? parseFloat(chStr) : undefined,
      scanlator: dto.source ?? undefined,
      dateUpload: Number.isNaN(parsed) ? undefined : parsed,
    };
  }

  private apiHeaders(): Record<string, string> {
    return { Accept: 'application/json, text/plain, */*' };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/list/popular?page=${page}&limit=${PAGE_SIZE}`, { headers: this.apiHeaders() });
    const data = res.data as ListResponse;
    const mangas = (data.data ?? []).map(d => toManga(d, this.useEnglishTitle));
    return { mangas, hasNextPage: mangas.length >= PAGE_SIZE };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/list/latest?page=${page}&limit=${PAGE_SIZE}`, { headers: this.apiHeaders() });
    const data = res.data as ListResponse;
    const mangas = (data.data ?? []).map(d => toManga(d, this.useEnglishTitle));
    return { mangas, hasNextPage: mangas.length >= PAGE_SIZE };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.apiUrl}/search/advanced`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (query) url.searchParams.set('title', query);
    const res = await this.get(url.toString(), { headers: this.apiHeaders() });
    const data = res.data as ListResponse;
    const mangas = (data.data ?? []).map(d => toManga(d, this.useEnglishTitle));
    return { mangas, hasNextPage: mangas.length >= PAGE_SIZE };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const res = await this.get(`${this.apiUrl}/manga/${slug}`, { headers: this.apiHeaders() });
    const data = res.data as DetailsResponse;
    return this.toDetailsManga(data.manga);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const res = await this.get(`${this.apiUrl}/manga/${slug}`, { headers: this.apiHeaders() });
    const data = res.data as DetailsResponse;
    return (data.chapters ?? []).map(c => this.toChapter(c, data.manga.slug));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('/').filter(Boolean).pop() ?? '';
    const res = await this.get(`${this.apiUrl}/chapter/${chapterId}`, { headers: this.apiHeaders() });
    const data = res.data as PageListResponse;
    return (data.pages ?? []).map((url, index) => ({ index, imageUrl: url }));
  }
}
