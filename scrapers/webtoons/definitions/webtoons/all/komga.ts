import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jxl', 'image/heif', 'image/avif'];

interface PageWrapper<T> {
  content: T[];
  empty: boolean;
  first: boolean;
  last: boolean;
  number: number;
  numberOfElements: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

interface Library {
  id: string;
  name: string;
}

interface Author {
  name: string;
  role: string;
}

interface BookMetadata {
  title: string;
  summary: string;
  number: string;
  numberSort: number;
  releaseDate?: string;
  authors: Author[];
  tags: string[];
}

interface Media {
  status: string;
  mediaType: string;
  pagesCount: number;
  mediaProfile: string;
  epubDivinaCompatible: boolean;
}

interface Book {
  id: string;
  seriesId: string;
  seriesTitle: string;
  name: string;
  number: number;
  created?: string;
  lastModified?: string;
  fileLastModified: string;
  sizeBytes: number;
  size: string;
  media: Media;
  metadata: BookMetadata;
}

interface SeriesMetadata {
  status: string;
  title: string;
  summary: string;
  genres: string[];
  tags: string[];
  totalBookCount?: number;
}

interface BookMetadataAggregation {
  authors: Author[];
  tags: string[];
  summary: string;
}

interface Series {
  id: string;
  libraryId: string;
  name: string;
  created?: string;
  lastModified?: string;
  fileLastModified: string;
  booksCount: number;
  metadata: SeriesMetadata;
  booksMetadata: BookMetadataAggregation;
}

interface PageInfo {
  number: number;
  fileName: string;
  mediaType: string;
}

interface Collection {
  id: string;
  name: string;
  ordered: boolean;
  seriesIds: string[];
  createdDate: string;
  lastModifiedDate: string;
  filtered: boolean;
}

interface ReadList {
  id: string;
  name: string;
  summary: string;
  bookIds: string[];
  createdDate: string;
  lastModifiedDate: string;
  filtered: boolean;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}/;
const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function isFromReadList(url: string): boolean {
  return url.includes('/api/v1/readlists');
}

function isFromBook(url: string): boolean {
  return url.includes('/api/v1/books');
}

function parseDate(date: string): number {
  const m = date.match(DATE_REGEX);
  if (!m) return 0;
  const ts = Date.parse(m[0]);
  return isNaN(ts) ? 0 : ts;
}

function parseDateTime(date: string): number {
  const m = date.match(DATETIME_REGEX);
  if (!m) return 0;
  const ts = Date.parse(m[0]);
  return isNaN(ts) ? 0 : ts;
}

function seriesToStatus(metadata: SeriesMetadata, booksCount: number): number {
  if (metadata.status === 'ENDED') {
    if (metadata.totalBookCount != null && booksCount < metadata.totalBookCount) return 4;
    return 1;
  }
  if (metadata.status === 'ONGOING') return 2;
  if (metadata.status === 'ABANDONED') return 5;
  if (metadata.status === 'HIATUS') return 3;
  return 0;
}

function getChapterName(book: Book, template: string, isFromReadList: boolean): string {
  const values: Record<string, string> = {
    title: book.metadata.title,
    seriesTitle: book.seriesTitle,
    number: book.metadata.number,
    createdDate: book.created ?? '',
    releaseDate: book.metadata.releaseDate ?? '',
    size: book.size,
    sizeBytes: String(book.sizeBytes),
  };
  let result = template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  if (isFromReadList) result = `${book.seriesTitle} ${result}`;
  return result;
}

export class KomgaScraper extends BaseScraper {
  readonly name = 'Komga';
  readonly baseUrl = '';
  readonly lang = 'all';

  private baseServerUrl = '';

  setServerUrl(url: string): void {
    this.baseServerUrl = url.replace(/\/+$/, '');
    (this as any).baseUrl = this.baseServerUrl;
    (this as any).name = `Komga (${new URL(url).hostname})`;
  }

  private getHeaders(): Record<string, string> {
    return {};
  }

  async getPopular(page: number): Promise<SearchResult> {
    return this.search({ page, sort: 'metadata.titleSort,asc' });
  }

  async getLatest(page: number): Promise<SearchResult> {
    return this.search({ page, sort: 'lastModifiedDate,desc' });
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    return this.search({ page: page ?? 1, query, sort: 'relevance,asc' });
  }

  async getMangaDetail(mangaUrl: string): Promise<Manga> {
    const res = await this.get(mangaUrl, this.getHeaders());
    const url = mangaUrl;
    if (isFromBook(url)) {
      const book = res.data as Book;
      return {
        title: book.metadata.title,
        url: `${this.baseServerUrl}/api/v1/books/${book.id}`,
        thumbnail: `${this.baseServerUrl}/api/v1/books/${book.id}/thumbnail`,
        status: 0,
        genres: [...new Set(book.metadata.tags)].join(', ') || undefined,
        description: book.metadata.summary || undefined,
        author: book.metadata.authors.map(a => a.name).join(', ') || undefined,
        artist: book.metadata.authors.map(a => a.name).join(', ') || undefined,
      };
    }
    if (isFromReadList(url)) {
      const list = res.data as ReadList;
      return {
        title: list.name,
        url: `${this.baseServerUrl}/api/v1/readlists/${list.id}`,
        thumbnail: `${this.baseServerUrl}/api/v1/readlists/${list.id}/thumbnail`,
        status: 0,
        description: list.summary || undefined,
      };
    }
    const series = res.data as Series;
    const authorMap = new Map<string, string[]>();
    for (const a of series.booksMetadata.authors) {
      if (!authorMap.has(a.role)) authorMap.set(a.role, []);
      authorMap.get(a.role)!.push(a.name);
    }
    return {
      title: series.metadata.title,
      url: `${this.baseServerUrl}/api/v1/series/${series.id}`,
      thumbnail: `${this.baseServerUrl}/api/v1/series/${series.id}/thumbnail`,
      status: seriesToStatus(series.metadata, series.booksCount),
      genres: [...new Set([...series.metadata.genres, ...series.metadata.tags, ...series.booksMetadata.tags])].sort().join(', ') || undefined,
      description: series.metadata.summary || series.booksMetadata.summary || undefined,
      author: [...new Set(authorMap.get('writer') ?? [])].join(', ') || undefined,
      artist: [...new Set(authorMap.get('penciller') ?? [])].join(', ') || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    if (isFromBook(mangaUrl)) {
      const res = await this.get(`${mangaUrl}?unpaged=true&media_status=READY&deleted=false`, this.getHeaders());
      const book = res.data as Book;
      const translator = book.metadata.authors.filter(a => a.role === 'translator').map(a => a.name).join(', ');
      return [{
        chapterNumber: 1,
        url: `${this.baseServerUrl}/api/v1/books/${book.id}`,
        name: getChapterName(book, '{number} - {title} ({size})', true),
        scanlator: translator || undefined,
        date: book.metadata.releaseDate ? parseDate(book.metadata.releaseDate)
          : book.created ? parseDateTime(book.created)
          : parseDateTime(book.fileLastModified),
      }];
    }

    const res = await this.get(`${mangaUrl}/books?unpaged=true&media_status=READY&deleted=false`, this.getHeaders());
    const page = res.data as PageWrapper<Book>;
    const isReadList = isFromReadList(mangaUrl);

    return page.content
      .filter(b => b.media.mediaProfile !== 'EPUB' || b.media.epubDivinaCompatible)
      .map((book, index) => {
        const translator = book.metadata.authors.filter(a => a.role === 'translator').map(a => a.name).join(', ');
        return {
          chapterNumber: !isReadList ? book.metadata.numberSort : index + 1,
          url: `${this.baseServerUrl}/api/v1/books/${book.id}`,
          name: getChapterName(book, '{number} - {title} ({size})', isReadList),
          scanlator: translator || undefined,
          date: book.metadata.releaseDate ? parseDate(book.metadata.releaseDate)
            : book.created ? parseDateTime(book.created)
            : parseDateTime(book.fileLastModified),
        };
      })
      .sort((a, b) => b.chapterNumber - a.chapterNumber);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${chapterUrl}/pages`, this.getHeaders());
    const pages = res.data as PageInfo[];
    return pages.map(p => {
      const url = `${chapterUrl}/pages/${p.number}` +
        (!SUPPORTED_IMAGE_TYPES.includes(p.mediaType) ? '?convert=png' : '');
      return { index: p.number, url, imageUrl: url };
    });
  }

  private async search(opts: { page: number; query?: string; sort?: string }): Promise<SearchResult> {
    const url = new URL(`${this.baseServerUrl}/api/v1/series`);
    url.searchParams.set('search', opts.query ?? '');
    url.searchParams.set('page', String(opts.page - 1));
    url.searchParams.set('deleted', 'false');
    if (opts.sort) url.searchParams.set('sort', opts.sort);

    const res = await this.get(url.toString(), this.getHeaders());
    const data = res.data as PageWrapper<Series>;

    const mangas: Manga[] = data.content.map(s => {
      const authorMap = new Map<string, string[]>();
      for (const a of s.booksMetadata.authors) {
        if (!authorMap.has(a.role)) authorMap.set(a.role, []);
        authorMap.get(a.role)!.push(a.name);
      }
      return {
        title: s.metadata.title,
        url: `${this.baseServerUrl}/api/v1/series/${s.id}`,
        thumbnail: `${this.baseServerUrl}/api/v1/series/${s.id}/thumbnail`,
        status: seriesToStatus(s.metadata, s.booksCount),
        genres: [...new Set([...s.metadata.genres, ...s.metadata.tags, ...s.booksMetadata.tags])].sort().join(', ') || undefined,
        description: s.metadata.summary || s.booksMetadata.summary || undefined,
        author: [...new Set(authorMap.get('writer') ?? [])].join(', ') || undefined,
        artist: [...new Set(authorMap.get('penciller') ?? [])].join(', ') || undefined,
      };
    });

    return { mangas, hasNextPage: !data.last };
  }
}
