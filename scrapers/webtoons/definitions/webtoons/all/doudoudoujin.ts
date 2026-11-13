import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

type TurboValue =
  | string
  | number
  | boolean
  | null
  | TurboValue[]
  | { [key: string]: TurboValue };

interface SeriesDto {
  title: string;
  slug: string;
  author?: string | null;
  description?: string | null;
  status?: string | null;
  thumbnailUrl?: string | null;
  genres?: { name: string }[];
}

interface SeriesListDto {
  series: {
    items: SeriesDto[];
    next: string | null;
  };
}

interface MangaDto {
  title: string;
  slug: string;
  language: string;
  chapterNumber?: number | null;
  publishDate?: string | null;
}

interface SeriesDetailsDto {
  series: SeriesDto;
  mangas: MangaDto[];
}

interface MangaPagesDto {
  manga: {
    pages: { pageNumber: number; imageUrl: string }[];
  };
}

function decodeTurboStream(source: unknown[]): TurboValue {
  const decoded = new Map<number, TurboValue>();

  const decode = (index: number): TurboValue => {
    if (index < 0) return null;
    const cached = decoded.get(index);
    if (cached !== undefined) return cached;

    const value = source[index];
    let result: TurboValue;

    if (Array.isArray(value)) {
      result = value.map(item => decode(Number(item)));
    } else if (value !== null && typeof value === 'object') {
      const object: { [key: string]: TurboValue } = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const keyValue = source[Number(key.slice(1))];
        if (typeof keyValue === 'string') {
          object[keyValue] = decode(Number(item));
        }
      }
      result = object;
    } else {
      result = value as TurboValue;
    }

    decoded.set(index, result);
    return result;
  };

  return decode(0);
}

export class DoudouDoujinScraper extends BaseScraper {
  readonly name = 'DouDouDoujin';
  readonly baseUrl = 'https://doudoudoujin.com';
  readonly lang = 'all';

  private async fetchData<T>(path: string, query?: URLSearchParams): Promise<T> {
    const search = query && query.toString() ? `?${query.toString()}` : '';
    const res = await this.get(`${this.baseUrl}${path}.data${search}`, {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const root = decodeTurboStream(res.data as unknown[]);
    if (root === null || Array.isArray(root) || typeof root !== 'object') {
      throw new Error(`${this.name}: unexpected data payload`);
    }

    const values = Object.values(root);
    const last = values[values.length - 1];
    if (last === null || Array.isArray(last) || typeof last !== 'object') {
      throw new Error(`${this.name}: unexpected route data`);
    }

    const data = (last as { [key: string]: TurboValue }).data;
    if (data === undefined) {
      throw new Error(`${this.name}: missing route data`);
    }

    return data as T;
  }

  private toManga(series: SeriesDto): Manga {
    return {
      title: series.title,
      url: `/series/${series.slug}`,
      thumbnailUrl: series.thumbnailUrl ?? '',
      lang: this.lang,
      author: series.author ?? undefined,
      description: series.description ?? undefined,
      genre: series.genres?.map(genre => genre.name).join(', ') || undefined,
      status: series.status === 'ongoing' ? 1 : series.status === 'completed' ? 0 : undefined,
    };
  }

  private async fetchSeries(): Promise<SeriesDto[]> {
    const series: SeriesDto[] = [];
    let cursor: string | null = null;

    do {
      const query = new URLSearchParams();
      if (cursor) query.set('after', cursor);
      const data = await this.fetchData<SeriesListDto>('/series', query);
      series.push(...data.series.items);
      cursor = data.series.next;
    } while (cursor);

    return series;
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const series = await this.fetchSeries();
    return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not supported (supportsLatest = false)`);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const needle = query.trim().toLowerCase();
    const series = await this.fetchSeries();
    const mangas = series
      .filter(item => {
        if (!needle) return true;
        return (
          item.title.toLowerCase().includes(needle) ||
          (item.author ?? '').toLowerCase().includes(needle)
        );
      })
      .map(item => this.toManga(item));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean).pop() ?? '';
    const data = await this.fetchData<SeriesDetailsDto>(`/series/${slug}`);
    return this.toManga(data.series);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean).pop() ?? '';
    const data = await this.fetchData<SeriesDetailsDto>(`/series/${slug}`);

    return data.mangas
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0))
      .map(manga => {
        const chapter: Chapter = {
          name: manga.title,
          url: `/mangas/${manga.slug}`,
          chapterNumber: manga.chapterNumber ?? -1,
          scanlator: manga.language,
        };
        if (manga.publishDate) {
          const timestamp = Date.parse(manga.publishDate);
          if (!Number.isNaN(timestamp)) chapter.dateUpload = timestamp;
        }
        return chapter;
      });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = new URL(this.absUrl(chapterUrl)).pathname.split('/').filter(Boolean).pop() ?? '';
    const data = await this.fetchData<MangaPagesDto>(`/mangas/${slug}`);
    return data.manga.pages
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((page, index) => ({ index, imageUrl: page.imageUrl }));
  }
}
