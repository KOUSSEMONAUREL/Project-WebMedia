import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const FIRESTORE_HOST = 'https://firestore.googleapis.com';
const DATA_URL = `${FIRESTORE_HOST}/v1/projects/lazymonkiscan/databases/(default)/documents/artifacts/lazymonki-public/public/data`;
const API_KEY = 'AIzaSyCf2juYah43MfbuEtGndbh08zzC2tN4m8E';
const MANGADEX_API = 'https://api.mangadex.org';
const STORED_IMAGE_PREFIX = 'firestore:img:';
const MANGA_LIST_FIELDS = ['title', 'coverUrl', 'genres', 'views', 'createdAt'];
const CHAPTER_FIELDS = ['mangaId', 'number', 'chapterNumber', 'title', 'type', 'createdAt'];

interface ValueDto {
  stringValue?: string | null;
  integerValue?: string | null;
  doubleValue?: string | number | null;
  timestampValue?: string | null;
  arrayValue?: { values?: ValueDto[] } | null;
  mapValue?: { fields?: Record<string, ValueDto> } | null;
}

interface DocumentDto {
  name: string;
  fields?: Record<string, ValueDto>;
}

interface ListDto {
  documents?: DocumentDto[];
  nextPageToken?: string | null;
}

interface AtHomeDto {
  baseUrl: string;
  chapter: { hash: string; data: string[] };
}

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

function textOf(value: ValueDto | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.stringValue ?? value.integerValue ?? (value.doubleValue !== undefined ? String(value.doubleValue) : undefined) ?? value.timestampValue;
  return text && text.trim().length > 0 ? text : undefined;
}

export class LazyMonkiScansScraper extends BaseScraper {
  readonly name = 'Lazy Monki Scans';
  readonly baseUrl = 'https://lazy-monki-scans.netlify.app';
  readonly lang = 'en';

  private documentUrl(path: string, fields: string[] = []): string {
    const url = new URL(`${DATA_URL}/${path}`);
    url.searchParams.set('key', API_KEY);
    for (const field of fields) url.searchParams.append('mask.fieldPaths', field);
    return url.toString();
  }

  private documentId(document: DocumentDto): string {
    return document.name.substring(document.name.lastIndexOf('/') + 1);
  }

  private text(document: DocumentDto, field: string): string | undefined {
    return textOf(document.fields?.[field]);
  }

  private list(document: DocumentDto, field: string): ValueDto[] {
    return document.fields?.[field]?.arrayValue?.values ?? [];
  }

  private views(document: DocumentDto): number {
    return Number.parseInt(this.text(document, 'views') ?? '0', 10) || 0;
  }

  private dateOf(document: DocumentDto, field: string): number | undefined {
    const value = this.text(document, field);
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private async fetchDocuments(collection: string, fields: string[]): Promise<DocumentDto[]> {
    const documents: DocumentDto[] = [];
    let pageToken: string | null | undefined;
    do {
      const url = new URL(this.documentUrl(collection, fields));
      url.searchParams.set('pageSize', '300');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await this.client.get(url.toString(), { headers: { Accept: 'application/json' } });
      const page = parseJson<ListDto>(res.data);
      documents.push(...(page.documents ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return documents;
  }

  private async fetchMangas(): Promise<DocumentDto[]> {
    return this.fetchDocuments('mangas', MANGA_LIST_FIELDS);
  }

  private coverUrl(document: DocumentDto): string {
    const cover = this.text(document, 'coverUrl');
    if (!cover) return '';
    if (cover.startsWith('data:')) return this.documentUrl(`mangas/${this.documentId(document)}`, ['coverUrl']);
    return cover;
  }

  private toManga(document: DocumentDto): Manga {
    return {
      title: this.text(document, 'title') ?? this.documentId(document),
      url: this.absUrl(`/?view=manga&manga=${this.documentId(document)}`),
      thumbnailUrl: this.coverUrl(document),
      lang: this.lang,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const mangas = await this.fetchMangas();
    return {
      mangas: mangas.sort((a, b) => this.views(b) - this.views(a)).map(document => this.toManga(document)),
      hasNextPage: false,
    };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const [chapters, mangas] = await Promise.all([
      this.fetchDocuments('chapters', ['mangaId', 'createdAt']),
      this.fetchMangas(),
    ]);
    const lastUpdate = new Map<string, number>();
    for (const chapter of chapters) {
      const mangaId = this.text(chapter, 'mangaId');
      const date = this.dateOf(chapter, 'createdAt') ?? 0;
      if (mangaId) lastUpdate.set(mangaId, Math.max(lastUpdate.get(mangaId) ?? 0, date));
    }
    return {
      mangas: mangas
        .sort((a, b) => {
          const aDate = lastUpdate.get(this.documentId(a)) ?? this.dateOf(a, 'createdAt') ?? 0;
          const bDate = lastUpdate.get(this.documentId(b)) ?? this.dateOf(b, 'createdAt') ?? 0;
          return bDate - aDate;
        })
        .map(document => this.toManga(document)),
      hasNextPage: false,
    };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    const mangas = await this.fetchMangas();
    return {
      mangas: mangas
        .filter(document => !term || (this.text(document, 'title') ?? '').toLowerCase().includes(term))
        .sort((a, b) => this.views(b) - this.views(a))
        .map(document => this.toManga(document)),
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.mangaId(mangaUrl);
    if (!id) return {};
    const res = await this.client.get(this.documentUrl(`mangas/${id}`), { headers: { Accept: 'application/json' } });
    const document = parseJson<DocumentDto>(res.data);
    const status = this.text(document, 'status')?.toLowerCase();
    return {
      title: this.text(document, 'title') ?? id,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: this.coverUrl(document),
      description: this.text(document, 'description'),
      genre: this.list(document, 'genres')
        .map(value => textOf(value))
        .filter((value): value is string => Boolean(value))
        .join(', ') || undefined,
      status: this.toStatus(status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.mangaId(mangaUrl);
    if (!id) return [];
    const chapters = await this.fetchDocuments('chapters', CHAPTER_FIELDS);
    return chapters
      .filter(document => this.text(document, 'mangaId') === id)
      .map(document => this.toChapter(document, id))
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  private toChapter(document: DocumentDto, mangaId: string): Chapter {
    const numberText = [this.text(document, 'number'), this.text(document, 'chapterNumber')]
      .find(value => value !== undefined && Number.isFinite(Number.parseFloat(value)));
    const number = numberText ? Number.parseFloat(numberText) : undefined;
    const title = this.text(document, 'title');
    const name = [number !== undefined ? `Chapter ${numberText}` : undefined, title]
      .filter((value): value is string => Boolean(value))
      .join(': ') || 'Chapter';
    return {
      name,
      url: this.absUrl(`/?view=reader&manga=${mangaId}&chapter=${this.documentId(document)}`),
      chapterNumber: number,
      dateUpload: this.dateOf(document, 'createdAt'),
      scanlator: this.text(document, 'type') === 'mtl' ? 'MTL' : undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(this.absUrl(chapterUrl));
    const chapterId = url.searchParams.get('chapter');
    if (!chapterId) return [];
    const res = await this.client.get(this.documentUrl(`chapters/${chapterId}`, ['pages', 'source', 'externalId']), {
      headers: { Accept: 'application/json' },
    });
    const document = parseJson<DocumentDto>(res.data);
    if (this.text(document, 'source') === 'mangadex') {
      const externalId = this.text(document, 'externalId');
      if (!externalId) return [];
      const atHome = await this.client.get(`${MANGADEX_API}/at-home/server/${externalId}`, {
        headers: { 'User-Agent': 'Tachiyomi Mozilla/5.0', Accept: 'application/json' },
      });
      const data = parseJson<AtHomeDto>(atHome.data);
      return data.chapter.data.map((image, index) => ({
        index,
        imageUrl: `${data.baseUrl}/data/${data.chapter.hash}/${image}`,
      }));
    }
    const urls = this.list(document, 'pages').map(value => {
      const page = textOf(value) ?? textOf(value.mapValue?.fields?.imageUrl);
      if (!page) return null;
      if (page.startsWith(STORED_IMAGE_PREFIX)) {
        return this.documentUrl(`images/${page.substring(STORED_IMAGE_PREFIX.length)}`, ['data']);
      }
      return page;
    });
    return urls
      .filter((imageUrl): imageUrl is string => Boolean(imageUrl))
      .map((imageUrl, index) => ({ index, imageUrl }));
  }

  private mangaId(mangaUrl: string): string | undefined {
    try {
      return new URL(this.absUrl(mangaUrl)).searchParams.get('manga') ?? undefined;
    } catch {
      return undefined;
    }
  }

  private toStatus(status: string | undefined): MangaStatus {
    switch (status) {
      case 'ongoing': return 1;
      case 'completed': return 0;
      case 'cancelled': return 2;
      default: return 3;
    }
  }
}
