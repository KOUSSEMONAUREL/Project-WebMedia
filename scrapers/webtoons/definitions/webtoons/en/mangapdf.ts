import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface MangaSummaryDto {
  id: string;
  title: string;
  thumbnail_url?: string;
}

interface MangaListResponse {
  items: MangaSummaryDto[];
  has_next: boolean;
}

interface MangaDto {
  id: string;
  title: string;
  thumbnail_url?: string;
  author?: string;
  artist?: string;
  description?: string;
  genres?: string[];
  status?: string;
}

interface ChapterDto {
  id: string;
  name: string;
  number?: number;
  scanlator?: string;
  uploaded_at?: string;
}

interface MangaUpdateResponse {
  manga: MangaDto;
  chapters: ChapterDto[];
}

interface PageListResponse {
  pages: Array<{ image_url: string }>;
}

function toStatus(s: string | undefined): MangaStatus {
  switch (s?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed':
    case 'publishing_finished': return 0;
    default: return 3;
  }
}

const STATIC_HEADERS = { 'X-Client': 'mihon-extension' };

export class MangapdfScraper extends BaseScraper {
  readonly name = 'MANGAPDF';
  readonly baseUrl = 'https://mangapdf.org';
  readonly lang = 'en';

  private readonly apiUrl = 'https://api.coffeemanga.shop/api/v1/mihon';

  private async apiGet(path: string, params: Record<string, string> = {}): Promise<any> {
    const qs = Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
    const res = await this.get(`${this.apiUrl}${path}${qs}`, { headers: STATIC_HEADERS } as any);
    return res.data;
  }

  private toManga(m: MangaSummaryDto): Manga {
    return {
      title: m.title,
      url: m.id,
      thumbnailUrl: m.thumbnail_url || '',
      lang: this.lang,
    };
  }

  private async list(url: string): Promise<SearchResult> {
    const data = await this.apiGet(url) as MangaListResponse;
    return {
      mangas: (data.items || []).map(m => this.toManga(m)),
      hasNextPage: !!data.has_next,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.list(`/popular?page=${page}`);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.list(`/latest?page=${page}`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.list(`/search?q=${encodeURIComponent(query)}&page=${page}`);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.replace(/\/$/, '');
    const data = await this.apiGet(`/manga/${encodeURIComponent(id)}`) as MangaUpdateResponse;
    const m = data.manga;
    const manga: Partial<Manga> = {
      title: m.title,
      url: m.id,
      thumbnailUrl: m.thumbnail_url || '',
      author: m.author || undefined,
      artist: m.artist || undefined,
      description: m.description || undefined,
      genre: m.genres?.length ? m.genres.join(', ') : undefined,
      status: toStatus(m.status),
      lang: this.lang,
    };
    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.replace(/\/$/, '');
    const data = await this.apiGet(`/manga/${encodeURIComponent(id)}`) as MangaUpdateResponse;
    return (data.chapters || []).map(ch => ({
      name: ch.name,
      url: ch.id,
      chapterNumber: ch.number ?? -1,
      scanlator: ch.scanlator || undefined,
      dateUpload: ch.uploaded_at ? new Date(ch.uploaded_at).getTime() : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.replace(/\/$/, '');
    const data = await this.apiGet(`/chapter/${encodeURIComponent(id)}/pages`) as PageListResponse;
    return (data.pages || []).map((p, index) => ({ index, imageUrl: p.image_url }));
  }
}