import https from 'https';
import { decodeHTML } from 'entities';
import { AxiosError } from 'axios';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const IPV4_AGENT = new https.Agent({ family: 4 });
const MANGA_PAGE_LIMIT = 20;
const SALT_EXPIRY_MS = 3 * 60 * 60 * 1000;
const FALLBACK_SALTS = ['a1f', 'Z0_9'];

interface MangaListItemDto {
  title: string;
  cover?: string;
  mangaSlug?: string | null;
  slug?: string | null;
}

interface ListResponseDto {
  total?: number;
  page?: number;
  limit?: number;
  data?: MangaListItemDto[];
}

interface MangaInfoDto {
  title: string;
  author?: string;
  status?: string;
  cover?: string;
  description?: string;
}

interface ChapterItemDto {
  slug: string;
  num: number;
  title?: string;
  time?: number;
}

interface MangaDetailsResponseDto {
  info: MangaInfoDto;
  chapters?: ChapterItemDto[];
}

interface ScanResponseDto {
  pageNumbers: number;
  pagesBaseUrl: string;
}

function toMangaSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function unescapeHtml(value: string | undefined): string {
  return value ? decodeHTML(value) : '';
}

export class MangamoinsScraper extends BaseScraper {
  readonly name = 'MangaMoins';
  readonly baseUrl = 'https://mangamoins.com';
  readonly lang = 'fr';

  private sessionCookie = '';
  private sessionWarmed = false;

  private cachedSalts: string[] = [];
  private lastSaltFetch = 0;

  private async ensureSession(): Promise<void> {
    if (this.sessionWarmed) return;
    const res = await this.get('/', { httpsAgent: IPV4_AGENT });
    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const c of cookies) {
      if (c.startsWith('mm_session=')) this.sessionCookie = c.split(';')[0];
    }
    this.sessionWarmed = true;
  }

  private async apiGet(path: string) {
    await this.ensureSession();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Origin: this.baseUrl,
    };
    if (this.sessionCookie) headers.Cookie = this.sessionCookie;
    const run = () => this.get(path, { headers, httpsAgent: IPV4_AGENT });
    try {
      return await run();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 403) {
        this.sessionWarmed = false;
        this.sessionCookie = '';
        await this.ensureSession();
        if (this.sessionCookie) headers.Cookie = this.sessionCookie;
        return run();
      }
      throw err;
    }
  }

  private toManga(item: MangaListItemDto): Manga {
    const slug = item.mangaSlug ?? item.slug ?? toMangaSlug(item.title);
    return {
      title: unescapeHtml(item.title).trim(),
      url: `${this.baseUrl}/manga/${slug}`,
      thumbnailUrl: item.cover ?? '',
      lang: this.lang,
    };
  }

  private parseList(data: ListResponseDto): SearchResult {
    const mangas = (data.data ?? []).map(item => this.toManga(item));
    const page = data.page ?? 1;
    const limit = data.limit ?? MANGA_PAGE_LIMIT;
    const total = data.total ?? 0;
    return { mangas, hasNextPage: page * limit < total };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.apiGet('/api/v1/trend');
    const data = res.data as ListResponseDto;
    return { mangas: (data.data ?? []).map(item => this.toManga(item)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.apiGet(`/api/v1/mangas?page=${page}&limit=${MANGA_PAGE_LIMIT}`);
    return this.parseList(res.data as ListResponseDto);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = `/api/v1/explore?page=${page}&limit=${MANGA_PAGE_LIMIT}${
      query ? `&q=${encodeURIComponent(query)}` : ''
    }`;
    const res = await this.apiGet(url);
    return this.parseList(res.data as ListResponseDto);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/manga/')[1] ?? '';
    const res = await this.apiGet(`/api/v1/manga?manga=${encodeURIComponent(slug)}`);
    const data = res.data as MangaDetailsResponseDto;
    const info = data.info;
    let status: MangaStatus;
    const statusText = (info.status ?? '').toLowerCase();
    if (statusText.includes('en cours')) status = 1;
    else if (statusText.includes('termin')) status = 0;
    else status = undefined;
    const description = unescapeHtml(info.description).trim();
    return {
      url: mangaUrl,
      lang: this.lang,
      title: unescapeHtml(info.title).trim(),
      author: unescapeHtml(info.author).trim() || undefined,
      description: description || undefined,
      thumbnailUrl: info.cover ?? '',
      status,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/manga/')[1] ?? '';
    const res = await this.apiGet(`/api/v1/manga?manga=${encodeURIComponent(slug)}`);
    const data = res.data as MangaDetailsResponseDto;
    return (data.chapters ?? []).map(ch => {
      const chapterName = `Chapitre ${String(ch.num).replace(/\.0+$/, '')}`;
      const title = unescapeHtml(ch.title).trim();
      const name =
        title && title.toLowerCase() !== chapterName.toLowerCase()
          ? `${chapterName} - ${title}`
          : chapterName;
      return {
        name,
        url: `${this.baseUrl}/scan/${ch.slug}`,
        dateUpload: ch.time != null ? ch.time * 1000 : undefined,
      };
    });
  }

  private async getSalts(pagesBaseUrl: string): Promise<string[]> {
    const now = Date.now();
    if (this.cachedSalts.length > 0 && now - this.lastSaltFetch < SALT_EXPIRY_MS) {
      return this.cachedSalts;
    }
    try {
      const res = await this.get('/includes/components/js/reader.js', { httpsAgent: IPV4_AGENT });
      const script = String(res.data ?? '');
      const pathSegment = pagesBaseUrl.replace(/\/+$/, '').split('/').pop() ?? '';
      const salts = new Set<string>();
      const polochon = script.match(/polochon['"]?\s*\]?\s*=\s*['"]([^'"]+)['"]/);
      if (polochon && polochon[1] && pathSegment.includes(polochon[1])) {
        salts.add(polochon[1]);
      }
      const stringPattern = /(?:'([^']*)'|"([^"]*)")/g;
      for (const m of script.matchAll(stringPattern)) {
        const raw = m[1] ?? m[2] ?? '';
        const s = raw.replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        if (s.length >= 3 && pathSegment.includes(s)) salts.add(s);
      }
      const result = [...salts].sort((a, b) => b.length - a.length);
      if (result.length > 0) {
        this.cachedSalts = result;
        this.lastSaltFetch = now;
        return result;
      }
    } catch {}
    return [...FALLBACK_SALTS];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = chapterUrl.split('/scan/')[1] ?? chapterUrl.split('/').pop() ?? '';
    const res = await this.apiGet(`/api/v1/scan?slug=${encodeURIComponent(slug)}`);
    const data = res.data as ScanResponseDto;
    const salts = await this.getSalts(data.pagesBaseUrl);
    let base = data.pagesBaseUrl.replace(/\/+$/, '');
    if (base.endsWith('_b')) base = base.slice(0, -2);
    for (const salt of salts) base = base.split(salt).join('');
    return Array.from({ length: data.pageNumbers }, (_, i) => ({
      index: i,
      imageUrl: `${base}/${String(i + 1).padStart(2, '0')}.webp`,
    }));
  }
}