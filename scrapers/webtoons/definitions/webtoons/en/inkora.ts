import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface MangaDto {
  id: string;
  title: string;
  image?: string;
}

interface MangaListDto {
  results?: MangaDto[];
  hasNextPage?: boolean;
}

interface ScanGroupDto {
  name?: string;
}

interface ChapterDto {
  id: string;
  title?: string;
  chapterNumber?: number;
  releaseDate?: string;
  scanGroup?: ScanGroupDto;
  versions?: ChapterDto[];
}

interface InfoDto {
  id: string;
  title: string;
  altTitles?: string[];
  image?: string;
  description?: string;
  genres?: string[];
  status?: string;
  type?: string;
  year?: number;
  authors?: string[];
  artists?: string[];
  chapters?: ChapterDto[];
}

interface PageDto {
  page: number;
  img: string;
}

interface PageListDto {
  pages?: PageDto[];
}

const API_URL = 'https://api.spacely.tech/manhwa/index';

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

export class InkoraScraper extends BaseScraper {
  readonly name = 'Inkora';
  readonly baseUrl = 'https://inkora.spacely.tech';
  readonly lang = 'en';

  private statusFrom(text: string | undefined): MangaStatus {
    switch (text) {
      case 'releasing':
      case 'ongoing':
        return 1;
      case 'finished':
      case 'completed':
        return 0;
      case 'on_hiatus':
      case 'hiatus':
        return 2;
      case 'discontinued':
      case 'cancelled':
        return 2;
      default:
        return 3;
    }
  }

  private toManga(dto: MangaDto): Manga {
    return {
      title: dto.title,
      url: `${this.baseUrl}/title/${dto.id}`,
      thumbnailUrl: dto.image ?? '',
      lang: this.lang,
    };
  }

  private toChapters(info: InfoDto): Chapter[] {
    const mangaId = info.id;
    const chapters = (info.chapters ?? []).flatMap(chapter => [chapter, ...(chapter.versions ?? [])]);
    const seen = new Set<string>();

    return chapters
      .filter(chapter => {
        if (seen.has(chapter.id)) return false;
        seen.add(chapter.id);
        return true;
      })
      .map(chapter => {
        const number = chapter.chapterNumber;
        const name = chapter.title?.trim() || `Chapter ${number !== undefined ? String(number).replace(/\.0$/, '') : ''}`;
        const date = chapter.releaseDate ? Date.parse(chapter.releaseDate) : 0;
        return {
          name,
          url: `${mangaId}/${chapter.id}`,
          chapterNumber: number,
          scanlator: chapter.scanGroup?.name,
          dateUpload: date || undefined,
        };
      });
  }

  private mangaIdFrom(url: string): string {
    const path = new URL(this.absUrl(url)).pathname;
    const parts = path.split('/').filter(Boolean);
    const index = parts.indexOf('title');
    return index >= 0 ? (parts[index + 1] ?? '') : (parts[0] ?? '');
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.client.get(`${API_URL}/latest?page=${page}`, {
      headers: { Accept: 'application/json' },
    });
    const data = parseJson<MangaListDto>(res.data);
    return {
      mangas: (data.results ?? []).map(dto => this.toManga(dto)),
      hasNextPage: Boolean(data.hasNextPage),
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${API_URL}/advanced-search`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '24');
    if (query.trim()) url.searchParams.set('q', query.trim());
    url.searchParams.set('sort', 'follows');
    url.searchParams.set('order', 'desc');

    const res = await this.client.get(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    const data = parseJson<MangaListDto>(res.data);
    return {
      mangas: (data.results ?? []).map(dto => this.toManga(dto)),
      hasNextPage: Boolean(data.hasNextPage),
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.mangaIdFrom(mangaUrl);
    const res = await this.client.get(`${API_URL}/info/${id}`, {
      headers: { Accept: 'application/json' },
    });
    const info = parseJson<InfoDto>(res.data);
    const genres = (info.genres ?? []).map(genre => genre.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()));
    const details: Partial<Manga> = {
      title: info.title,
      url: `${this.baseUrl}/title/${id}`,
      thumbnailUrl: info.image,
      author: (info.authors ?? []).join(', ') || undefined,
      artist: (info.artists ?? []).join(', ') || undefined,
      description: info.description,
      genre: [...new Set([info.type, ...genres].filter((value): value is string => Boolean(value)))].join(', ') || undefined,
      status: this.statusFrom(info.status),
      lang: this.lang,
    };
    return details;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.mangaIdFrom(mangaUrl);
    const res = await this.client.get(`${API_URL}/info/${id}`, {
      headers: { Accept: 'application/json' },
    });
    return this.toChapters(parseJson<InfoDto>(res.data));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('/').slice(1).join('/');
    const res = await this.client.get(`${API_URL}/read/${chapterId}`, {
      headers: { Accept: 'application/json' },
    });
    const data = parseJson<PageListDto>(res.data);
    return (data.pages ?? [])
      .slice()
      .sort((a, b) => a.page - b.page)
      .map((page, index) => ({ index, imageUrl: page.img }));
  }
}
