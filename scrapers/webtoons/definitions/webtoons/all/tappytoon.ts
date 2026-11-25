import type { AxiosResponse } from 'axios';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Page, SearchResult } from '../../../engine/types';
import type { Chapter as EngineChapter } from '../../../engine/types';

const API_URL = 'https://api-global.tappytoon.com';

interface Comic {
  id: number;
  title: string;
  slug: string;
  longDescription: string;
  posterThumbnailUrl: string;
  isHiatus: boolean;
  isAccessible: boolean;
  isCompleted: boolean;
  ageRating: { name: string; canUserRead: boolean };
  genres: { name: string }[];
  authors: { name: string }[];
}

interface BookState {
  entities: {
    comics?: Record<string, { id: number; slug: string }>;
  };
}

interface TappytoonChapter {
  id: number;
  order: number;
  title: string;
  subtitle: string;
  isAccessible: boolean;
  isFree: boolean;
  isUserUnlocked: boolean;
  isUserRented: boolean;
  willAccessibleAt: string;
}

interface MediaItem {
  path: string;
}

interface MediaResponse {
  media: MediaItem[];
}

const genres: Record<string, string> = {
  'Action': 'action',
  'Romance': 'romance',
  'Fantasy': 'fantasy',
  'School': 'school',
  'Slice of Life': 'slice',
  'BL': 'bl',
  'Comedy': 'comedy',
  'GL': 'gl',
};

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export class TappytoonScraper extends BaseScraper {
  readonly name = 'Tappytoon';
  readonly baseUrl = 'https://www.tappytoon.com';
  readonly lang = 'en';

  private apiHeaders: Record<string, string> = {};

  private async ensureApiHeaders(): Promise<void> {
    if (this.apiHeaders['Authorization']) return;
    const res = await this.get(`${this.baseUrl}/comics/discover`);
    const $ = this.$(res.data);
    const nextData = $('#__NEXT_DATA__').html();
    if (!nextData) throw new Error('Could not find __NEXT_DATA__');
    const parsed = JSON.parse(nextData);
    const axiosHeaders = parsed.props.initialState.axios.headers;
    this.apiHeaders = {
      Origin: 'https://www.tappytoon.com',
      'Accept-Language': this.lang,
      Authorization: axiosHeaders.Authorization,
      'X-Device-Uuid': axiosHeaders['X-Device-Uuid'],
    };
  }

  private async apiGet(url: string, isRetry = false): Promise<AxiosResponse> {
    const res = await this.get(url, {
      headers: this.apiHeaders,
      validateStatus: isRetry ? undefined : () => true,
    });
    if (res.status !== 401 || isRetry) return res;
    this.apiHeaders = {};
    await this.ensureApiHeaders();
    return this.apiGet(url, true);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    await this.ensureApiHeaders();
    const res = await this.apiGet(
      `${API_URL}/comics?sort_by=trending&filter=completed&locale=${this.lang}`,
    );
    return this.parseComics(res);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    await this.ensureApiHeaders();
    const day = DAY_NAMES[new Date().getDay()];
    const res = await this.apiGet(
      `${API_URL}/comics?day_of_week=${day}&locale=${this.lang}`,
    );
    return this.parseComics(res);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    await this.ensureApiHeaders();
    const url = query ?
      `${API_URL}/comics?locale=${this.lang}&keyword=${encodeURIComponent(query)}` :
      `${API_URL}/comics?locale=${this.lang}`;
    const res = await this.apiGet(url);
    const data: Comic[] = res.data;
    const accessible = data.filter(c => c.isAccessible);
    const mangas: Manga[] = accessible.map(c => this.toManga(c));
    const linkHeader = res.headers['link'];
    return { mangas, hasNextPage: linkHeader != null };
  }

  private parseComics(res: AxiosResponse<Comic[]>): SearchResult {
    const data = res.data;
    const accessible = data.filter(c => c.isAccessible);
    const mangas: Manga[] = accessible.map(c => this.toManga(c));
    return { mangas, hasNextPage: false };
  }

  private toManga(c: Comic): Manga {
    return {
      url: `${this.baseUrl}/${this.lang}/book/${c.slug}`,
      title: c.title,
      thumbnailUrl: c.posterThumbnailUrl,
      lang: this.lang,
      author: c.authors.map(a => a.name).join(', '),
      description: c.longDescription,
    };
  }

  private async resolveComicId(mangaUrl: string): Promise<string> {
    const legacyId = mangaUrl.split('|')[1];
    if (legacyId) return legacyId;

    const url = this.absUrl(mangaUrl);
    const res = await this.get(url);
    const $ = this.$(String(res.data));
    const nextData = $('#__NEXT_DATA__').html();
    if (!nextData) throw new Error('Could not find __NEXT_DATA__');
    const parsed = JSON.parse(nextData) as { props?: { initialState?: BookState } };
    const comics = parsed.props?.initialState?.entities?.comics;
    if (!comics) throw new Error('Could not find comic entities');
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!slug) throw new Error('Could not find comic slug');
    const comic = Object.values(comics).find(entry => entry.slug === slug);
    if (!comic) throw new Error(`Could not find comic for slug ${slug}`);
    return String(comic.id);
  }

  async getChapterList(mangaUrl: string): Promise<EngineChapter[]> {
    await this.ensureApiHeaders();
    const id = await this.resolveComicId(mangaUrl);
    const res = await this.apiGet(
      `${API_URL}/comics/${id}/chapters?locale=${this.lang}`,
    );
    const data: TappytoonChapter[] = res.data;
    return data.filter(c => c.isAccessible).reverse().map(c => ({
      name: `${c.title}${c.subtitle ? ' - ' + c.subtitle : ''}${!c.isFree && !c.isUserUnlocked && !c.isUserRented ? ' 🔒' : ''}`,
      url: String(c.id),
      chapterNumber: c.order + 1,
      dateUpload: new Date(c.willAccessibleAt).getTime() || 0,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    await this.ensureApiHeaders();
    const res = await this.apiGet(
      `${API_URL}/content-delivery/contents?chapterId=${chapterUrl}&variant=high&locale=${this.lang}`,
    );
    const data = res.data as MediaResponse | string[];
    const urls = Array.isArray(data) ? data : (data.media || []).map(item => item.path);
    return urls.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
