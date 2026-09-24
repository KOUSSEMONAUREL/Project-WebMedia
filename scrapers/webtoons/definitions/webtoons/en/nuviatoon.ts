import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface Meta {
  current_page: number;
  last_page: number;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: Meta;
}

interface SeriesDto {
  title: string;
  slug: string;
  cover_url?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: string[] | null;
}

interface ChapterDto {
  id: string;
  title?: string | null;
  number?: number | null;
  created_at?: string | null;
}

interface PageDto {
  image_url: string;
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

function seriesToManga(dto: SeriesDto): Manga {
  return {
    title: dto.title,
    url: dto.slug,
    thumbnailUrl: dto.cover_url ?? '',
    author: dto.author ?? undefined,
    artist: dto.artist ?? undefined,
    description: dto.description ?? undefined,
    genre: dto.genres?.join(', ') ?? undefined,
    status: parseStatus(dto.status),
    lang: 'en',
  };
}

export class NuviatoonScraper extends BaseScraper {
  readonly name = 'Nuvia Toon';
  readonly baseUrl = 'https://nuviatoon.com';
  readonly lang = 'en';

  private async parseMangasPage(url: string): Promise<SearchResult> {
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data as PaginatedResponse<SeriesDto>;
    const mangas = (json.data ?? []).map(seriesToManga);
    const hasNextPage = json.meta ? json.meta.current_page < json.meta.last_page : false;
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.parseMangasPage(`${this.baseUrl}/nuvia-api/series?per_page=18&page=${page}&sort=views&dir=desc`);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.parseMangasPage(`${this.baseUrl}/nuvia-api/series?per_page=18&page=${page}&sort=created_at&dir=desc`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/nuvia-api/series`);
    url.searchParams.set('per_page', '18');
    url.searchParams.set('page', String(page));
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('sort', 'views');
    url.searchParams.set('dir', 'desc');
    return this.parseMangasPage(url.toString());
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').pop()?.split('?')[0] ?? mangaUrl.replace(/^.*\//, '').split(':')[0];
    const id = slug.split(':')[0];
    const res = await this.get(`${this.baseUrl}/nuvia-api/series/${id}`, { headers: { Accept: 'application/json' } });
    const dto = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as SeriesDto;
    const m = seriesToManga(dto);
    return { ...m, url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').pop()?.split('?')[0] ?? mangaUrl;
    const cleanSlug = slug.split(':')[0].split('/')[0];
    const res = await this.get(`${this.baseUrl}/nuvia-api/series/${cleanSlug}/chapters`, { headers: { Accept: 'application/json' } });
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as ChapterDto[];
    const list: Chapter[] = (Array.isArray(data) ? data : []).map((dto) => {
      const numStr = dto.number != null ? String(dto.number).replace(/\.0$/, '') : '';
      const name = dto.title ?? (numStr ? `Chapter ${numStr}` : 'Chapter');
      const dateUpload = dto.created_at ? Date.parse(dto.created_at) : undefined;
      return {
        name,
        url: `${cleanSlug}/chapter/${numStr}?id=${dto.id}`,
        chapterNumber: dto.number ?? undefined,
        dateUpload: Number.isNaN(dateUpload as number) ? undefined : dateUpload,
      };
    });
    return list.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.split('id=')[1]?.split('&')[0] ?? chapterUrl.split('/').pop() ?? '';
    if (!id) return [];
    const res = await this.get(`${this.baseUrl}/nuvia-api/chapters/${id}/pages`, { headers: { Accept: 'application/json' } });
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as PageDto[];
    const arr = Array.isArray(data) ? data : [];
    return arr.map((dto, index) => ({ index, imageUrl: dto.image_url }));
  }
}
