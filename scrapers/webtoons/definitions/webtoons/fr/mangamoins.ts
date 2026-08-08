import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface MangaListItem {
  title: string;
  slug?: string | null;
  mangaSlug?: string | null;
  cover?: string;
}

interface MangaListResponse {
  total?: number;
  page?: number;
  limit?: number;
  data: MangaListItem[];
}

interface MangaInfo {
  title: string;
  author?: string;
  status?: string;
  cover?: string;
  description?: string;
}

interface ChapterItem {
  slug: string;
  num: number;
  title?: string;
  time?: number;
}

interface MangaDetailsResponse {
  info?: MangaInfo;
  chapters?: ChapterItem[];
}

interface ScanResponse {
  pageNumbers: number;
  pagesBaseUrl: string;
}

function unescapeHtml(s: string): string {
  const named: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&apos;': "'", '&#039;': "'", '&#39;': "'", '&nbsp;': ' ',
  };
  return s
    .replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&[a-z]+;/gi, m => named[m.toLowerCase()] ?? m);
}

function toMangaSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export class MangamoinsScraper extends BaseScraper {
  readonly name = 'MangaMoins';
  readonly baseUrl = 'https://mangamoins.com';
  readonly lang = 'fr';

  private readonly apiUrl = `${this.baseUrl}/api/v1`;
  private readonly mangaPageLimit = 20;
  private readonly saltExpiry = 3 * 60 * 60 * 1000;
  private readonly fallbackSalts = ['a1f', 'Z0_9'];

  private sessionCookie = '';
  private cachedSalts: string[] = [];
  private lastSaltFetch = 0;

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.apiGet('/trend');
    const data = res.data as { data?: MangaListItem[] };
    const mangas = (data.data ?? []).map(item => this.toManga(item));
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.apiGet(`/mangas?page=${page}&limit=${this.mangaPageLimit}`);
    const data = res.data as MangaListResponse;
    const mangas = data.data.map(item => this.toManga(item));
    const hasNextPage = (data.page ?? 1) * (data.limit ?? 10) < (data.total ?? 0);
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    let path = `/explore?page=${page}&limit=${this.mangaPageLimit}`;
    if (query) path += `&q=${encodeURIComponent(query)}`;
    const res = await this.apiGet(path);
    const data = res.data as MangaListResponse;
    const mangas = data.data.map(item => this.toManga(item));
    const hasNextPage = (data.page ?? 1) * (data.limit ?? 10) < (data.total ?? 0);
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const data = await this.fetchMangaDetails(mangaUrl);
    const info = data.info;
    if (!info) throw new Error('Manga not found');
    let status: MangaStatus;
    const rawStatus = (info.status ?? '').toLowerCase();
    if (rawStatus.includes('en cours')) status = 1;
    else if (rawStatus.includes('termin')) status = 0;
    else status = undefined;
    const description = unescapeHtml(info.description ?? '').trim() || undefined;
    const author = unescapeHtml(info.author ?? '').trim() || undefined;
    return {
      title: unescapeHtml(info.title),
      url: mangaUrl,
      thumbnailUrl: info.cover,
      author,
      artist: author,
      description,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const data = await this.fetchMangaDetails(mangaUrl);
    return (data.chapters ?? []).map(ch => {
      const chapterName = `Chapitre ${ch.num.toString().replace(/\.0$/, '')}`;
      const title = unescapeHtml(ch.title ?? '').trim();
      const name = title && title.toLowerCase() !== chapterName.toLowerCase()
        ? `${chapterName} - ${title}`
        : chapterName;
      return {
        name,
        url: `${this.baseUrl}/scan/${ch.slug.replace(/^\/scan\//, '')}`,
        dateUpload: ch.time ? ch.time * 1000 : undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = chapterUrl.replace(`${this.baseUrl}/scan/`, '').replace(/^\//, '');
    const res = await this.apiGet(`/scan?slug=${encodeURIComponent(slug)}`);
    const data = res.data as ScanResponse;
    const salts = await this.getSalts(data.pagesBaseUrl);
    const imageBase = salts.reduce(
      (url, salt) => url.split(salt).join(''),
      data.pagesBaseUrl.replace(/\/+$/, '').replace(/_b$/, '')
    );
    return Array.from({ length: data.pageNumbers }, (_, i) => ({
      index: i,
      imageUrl: `${imageBase}/${String(i + 1).padStart(2, '0')}.webp`,
    }));
  }

  // ——— Privés ———

  private toManga(item: MangaListItem): Manga {
    const slug = item.mangaSlug ?? item.slug ?? toMangaSlug(item.title);
    return {
      title: unescapeHtml(item.title),
      url: `${this.baseUrl}/manga/${slug}`,
      thumbnailUrl: item.cover ?? '',
      lang: this.lang,
    };
  }

  private async fetchMangaDetails(mangaUrl: string): Promise<MangaDetailsResponse> {
    const slug = toMangaSlug(mangaUrl.split('/').pop() ?? '');
    const res = await this.apiGet(`/manga?manga=${encodeURIComponent(slug)}`);
    return res.data as MangaDetailsResponse;
  }

  private async apiGet(path: string) {
    const headers = {
      Origin: this.baseUrl,
      ...(this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
    };
    try {
      return await this.get(`${this.apiUrl}${path}`, { headers });
    } catch (err) {
      if (this.isForbidden(err)) {
        await this.fetchHome();
        return this.get(`${this.apiUrl}${path}`, {
          headers: { Origin: this.baseUrl, Cookie: this.sessionCookie },
        });
      }
      throw err;
    }
  }

  private isForbidden(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'response' in err &&
      (err as { response?: { status?: number } }).response?.status === 403
    );
  }

  private async fetchHome(): Promise<void> {
    try {
      const res = await this.get('/', { headers: { Origin: this.baseUrl } });
      const setCookie = (res.headers as Record<string, unknown>)['set-cookie'];
      const raw = Array.isArray(setCookie)
        ? (setCookie as string[]).find(c => c.startsWith('mm_session='))
        : typeof setCookie === 'string' && setCookie.startsWith('mm_session=')
          ? setCookie
          : undefined;
      if (raw) this.sessionCookie = raw.split(';')[0];
    } catch {}
  }

  private async getSalts(pagesBaseUrl: string): Promise<string[]> {
    const now = Date.now();
    if (this.cachedSalts.length > 0 && now - this.lastSaltFetch < this.saltExpiry) {
      return this.cachedSalts;
    }
    const pathSegment = pagesBaseUrl.replace(/\/+$/, '').split('/').pop() ?? '';
    try {
      const script = (await this.get('/includes/components/js/reader.js')).data as string;
      const salts: string[] = [];

      const polochon = script.match(/polochon["']?\s*\]?\s*=\s*["']([^"']+)["']/);
      if (polochon && pathSegment.includes(polochon[1])) salts.push(polochon[1]);

      for (const match of script.matchAll(/["']([^"']*)["']/g)) {
        const s = match[1].replace(/\\x([a-f\d]{2})/gi, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        if (s.length >= 3 && pathSegment.includes(s)) salts.push(s);
      }

      const result = [...new Set(salts)].sort((a, b) => b.length - a.length);
      if (result.length > 0) {
        this.cachedSalts = result;
        this.lastSaltFetch = now;
      }
      return result.length > 0 ? result : this.fallbackSalts;
    } catch {
      return this.cachedSalts.length > 0 ? this.cachedSalts : this.fallbackSalts;
    }
  }
}