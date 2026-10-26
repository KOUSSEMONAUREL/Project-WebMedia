import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const API_PATH = '/api/library';
const LANGUAGE = 'en';

interface InkrushComic {
  id: string;
  title: string;
  cover?: string | null;
  author?: string | null;
  description?: string | null;
  status?: string | null;
  genre?: string[] | null;
  themes?: string[] | null;
  format?: string | null;
  altTitles?: string[] | null;
  chapters?: InkrushChapter[];
}

interface InkrushChapter {
  id: string;
  chapterNumber: number;
  name: string;
  releaseDate?: string | null;
}

interface InkrushCatalog {
  comics?: InkrushComic[];
  hasNextPage?: boolean;
}

interface InkrushPages {
  pages?: Array<{ src: string }>;
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing':
      return 1;
    case 'completed':
      return 0;
    case 'hiatus':
      return 2;
    case 'cancelled':
    case 'canceled':
      return 2;
    default:
      return undefined;
  }
}

function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export class InkrushScraper extends BaseScraper {
  readonly name = 'INKRUSH';
  readonly baseUrl = 'https://inkrush.site';
  readonly lang = 'all';

  private apiUrl(action: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({ action, language: LANGUAGE, ...extra });
    return `${this.baseUrl}${API_PATH}?${params.toString()}`;
  }

  private toManga(item: InkrushComic): Manga {
    const genres = [item.format, ...(item.genre ?? []), ...(item.themes ?? [])]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const altTitles = item.altTitles ?? [];
    const description = [
      item.description?.trim(),
      altTitles.length > 0 ? `Alternative titles:\n${altTitles.map(title => `- ${title}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      title: item.title,
      url: `/#title/${item.id}`,
      thumbnailUrl: item.cover ? this.absUrl(item.cover) : '',
      lang: this.lang,
      author: item.author || undefined,
      description: description || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      status: parseStatus(item.status),
    };
  }

  private async catalog(category: string, page: number, query = ''): Promise<SearchResult> {
    const url = this.apiUrl('catalog', {
      q: query.trim(),
      category,
      page: String(page),
    });
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = res.data as InkrushCatalog;
    return {
      mangas: (data.comics ?? []).map(item => this.toManga(item)),
      hasNextPage: data.hasNextPage === true,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.catalog('popular', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.catalog('latest', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.catalog('trending', page, query);
  }

  private async detail(id: string): Promise<InkrushComic> {
    const res = await this.get(this.apiUrl('detail', { id, compact: '1' }), {
      headers: { Accept: 'application/json' },
    });
    return res.data as InkrushComic;
  }

  private idFromUrl(url: string): string {
    return url.split('/').filter(Boolean).pop() ?? '';
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const item = await this.detail(this.idFromUrl(mangaUrl));
    return { ...this.toManga(item), url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.idFromUrl(mangaUrl);
    const item = await this.detail(id);
    return (item.chapters ?? []).slice().reverse().map(chapter => ({
      name: chapter.name,
      url: `/#read/${id}/${chapter.id}`,
      chapterNumber: chapter.chapterNumber,
      dateUpload: parseDate(chapter.releaseDate),
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = this.idFromUrl(chapterUrl);
    const res = await this.get(this.apiUrl('pages', { id: chapterId }), {
      headers: { Accept: 'application/json' },
    });
    const data = res.data as InkrushPages;
    return (data.pages ?? []).map((page, index) => ({
      index,
      imageUrl: this.absUrl(page.src),
    }));
  }
}

export default InkrushScraper;
