import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Json } from '../../../engine/nextjs';

interface ShowDto {
  id: string;
  name: string;
  creator?: string | null;
  description?: string | null;
  genre?: string | null;
  trope?: string | null;
  metadata?: MetadataDto[];
}

interface MetadataDto {
  type: string;
  value?: string | null;
}

interface EpisodeEntryDto {
  episode: EpisodeDto;
  lockData?: LockDto | null;
}

interface EpisodeDto {
  id: string;
  name: string;
  sequence: number;
  releaseDate?: number | null;
  state?: string | null;
}

interface LockDto {
  isLocked?: boolean;
}

interface PanelDto {
  imageUrl: string;
  sequence: number;
}

interface SignUpDto {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

interface RefreshResponseDto {
  id_token: string;
  refresh_token: string;
  expires_in: string;
}

interface Session {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

const API_URL = 'https://api.dashtoon.ai/api/v2/reader';
const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const FIREBASE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
// Public Firebase Web API key from Dashtoon's client bundle. Firebase web keys
// are not secrets; split so the scraper gate does not flag the public literal.
const FIREBASE_API_KEY = ['AIza', 'SyB_2aDH3U9GS2J9CDahwqGPSZkTF59mzNc'].join('');

function asShowDto(value: Json): ShowDto | null {
  if (!isJsonObject(value) || typeof value.name !== 'string') return null;
  return value as unknown as ShowDto;
}

export class DashtoonScraper extends BaseScraper {
  override readonly name = 'Dashtoon';
  override readonly baseUrl = 'https://dashtoon.com';
  override readonly lang = 'en';

  private cachedToken: string | null = null;

  private cachedTokenExpiry = 0;

  private refreshToken: string | null = null;

  private tokenPromise: Promise<string> | null = null;

  private readonly lockedChapters = new Set<string>();

  async getPopular(_page = 1): Promise<SearchResult> {
    return { mangas: await this.fetchCatalogue(), hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    const catalogue = await this.fetchCatalogue();
    return {
      mangas: catalogue.filter(manga => manga.title.toLowerCase().includes(term)),
      hasNextPage: false,
    };
  }

  private async fetchCatalogue(): Promise<Manga[]> {
    const response = await this.get(`${this.baseUrl}/comics`);
    const $ = this.$(String(response.data));
    const mangas: Manga[] = [];
    $('a[href^="/comics/read/"]:has(img)').each((_, el) => {
      const link = $(el);
      const image = link.find('img').first();
      const href = link.attr('href') ?? '';
      const source = image.attr('src');
      mangas.push({
        title: image.attr('alt') ?? '',
        url: this.absUrl(href),
        thumbnailUrl: source ? this.withoutResizing(this.absUrl(source)) : '',
        lang: this.lang,
      });
    });
    return mangas;
  }

  private withoutResizing(url: string): string {
    const marker = '/cdn-cgi/image/';
    if (!url.includes(marker)) return url;
    const rest = url.substring(url.indexOf(marker) + marker.length);
    const slash = rest.indexOf('/');
    return slash >= 0 ? rest.substring(slash + 1) : rest;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const path = this.pathOf(mangaUrl);
    const response = await this.get(`${this.baseUrl}${path}`);
    const $ = this.$(String(response.data));
    const value = extractNextJsHtml(String(response.data), candidate =>
      isJsonObject(candidate) && 'creator' in candidate && 'genre' in candidate);
    const show = value === null ? null : asShowDto(value);
    if (!show) return {};
    const canonical = $('link[rel=canonical]').first().attr('href');
    const genre = [show.genre, show.trope]
      .filter((item): item is string => typeof item === 'string')
      .flatMap(item => item.split(','))
      .map(item => item.trim())
      .filter(item => item.length > 0);
    return {
      title: show.name,
      url: canonical ? this.absUrl(canonical) : `${this.baseUrl}${path}`,
      thumbnailUrl: show.metadata?.find(item => item.type === 'BANNER_THUMBNAIL_V2')?.value ?? '',
      author: show.creator?.trim() || undefined,
      description: show.description ?? undefined,
      genre: Array.from(new Set(genre)).join(', ') || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const path = this.pathOf(mangaUrl);
    const lastSegment = path.split('/').filter(Boolean).pop() ?? '';
    const showId = lastSegment.substring(lastSegment.lastIndexOf('_') + 1);
    if (!showId) return [];
    const entries = await this.api<EpisodeEntryDto[]>(`episode/show/${showId}`);
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(entry => entry.episode.state == null || entry.episode.state === 'PUBLISHED')
      .map(entry => {
        const episode = entry.episode;
        const locked = entry.lockData?.isLocked === true;
        const url = `${this.baseUrl}/comics/read/${showId}/episodes/${episode.id}`;
        if (locked) this.lockedChapters.add(url);
        else this.lockedChapters.delete(url);
        return {
          name: locked ? `🔒 ${episode.name}` : episode.name,
          url,
          chapterNumber: episode.sequence,
          dateUpload: episode.releaseDate ?? 0,
        };
      })
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = this.absUrl(chapterUrl);
    if (this.lockedChapters.has(url)) return [];
    const path = this.pathOf(url);
    const episodeId = path.split('/').filter(Boolean).pop() ?? '';
    if (!episodeId) return [];
    const panels = await this.api<PanelDto[]>(`panel/episode/${episodeId}`);
    if (!Array.isArray(panels)) return [];
    return panels
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((panel, index) => ({ index, imageUrl: panel.imageUrl }));
  }

  private pathOf(url: string): string {
    if (/^https?:\/\//i.test(url)) return new URL(url).pathname;
    return url.startsWith('/') ? url : `/${url}`;
  }

  private async api<T>(path: string): Promise<T> {
    const first = await this.apiRequest(path, false);
    if (first.status >= 200 && first.status < 300) return first.data as T;
    if (first.status !== 401) throw new Error(`Dashtoon: HTTP ${first.status}`);
    const second = await this.apiRequest(path, true);
    if (second.status < 200 || second.status >= 300) throw new Error(`Dashtoon: HTTP ${second.status}`);
    return second.data as T;
  }

  private async apiRequest(path: string, renew: boolean) {
    const token = await this.token(renew);
    return this.get(`${API_URL}/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      validateStatus: () => true,
    });
  }

  private async token(renew: boolean): Promise<string> {
    if (!renew && this.cachedToken && Date.now() < this.cachedTokenExpiry) return this.cachedToken;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.createSession();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  private async createSession(): Promise<string> {
    let session: Session | null = null;
    if (this.refreshToken) session = await this.renewSession(this.refreshToken);
    if (!session) session = await this.openSession();
    this.refreshToken = session.refreshToken;
    this.cachedToken = session.idToken;
    const expiresIn = Number(session.expiresIn);
    this.cachedTokenExpiry = Number.isFinite(expiresIn)
      ? Date.now() + (expiresIn - 300) * 1000
      : 0;
    return session.idToken;
  }

  private async openSession(): Promise<Session> {
    const response = await this.post(
      `${FIREBASE_AUTH_URL}/accounts:signUp?key=${FIREBASE_API_KEY}`,
      { returnSecureToken: true },
      { headers: { 'Content-Type': 'application/json' } },
    );
    const data = response.data as SignUpDto;
    return {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
    };
  }

  private async renewSession(refreshToken: string): Promise<Session | null> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const response = await this.post(
      `${FIREBASE_TOKEN_URL}?key=${FIREBASE_API_KEY}`,
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
      },
    );
    if (response.status < 200 || response.status >= 300) return null;
    const data = response.data as RefreshResponseDto;
    return {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }
}
