import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

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
  ageRating: { name: string };
  genres: { name: string }[];
  authors: { name: string }[];
}

interface Chapter {
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

interface URL {
  url: string;
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
    const res = await this.get(`${this.baseUrl}/${this.lang}`);
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

  async getPopular(page = 1): Promise<SearchResult> {
    await this.ensureApiHeaders();
    const res = await this.get(
      `${API_URL}/comics?sort_by=trending&filter=completed&locale=${this.lang}`,
      { headers: this.apiHeaders },
    );
    return this.parseComics(res);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    await this.ensureApiHeaders();
    const day = DAY_NAMES[new Date().getDay()];
    const res = await this.get(
      `${API_URL}/comics?day_of_week=${day}&locale=${this.lang}`,
      { headers: this.apiHeaders },
    );
    return this.parseComics(res);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    await this.ensureApiHeaders();
    const url = query ?
      `${API_URL}/comics?locale=${this.lang}&keyword=${encodeURIComponent(query)}` :
      `${API_URL}/comics?locale=${this.lang}`;
    const res = await this.get(url, { headers: this.apiHeaders });
    const data: Comic[] = res.data;
    const accessible = data.filter(c => c.isAccessible);
    const mangas: Manga[] = accessible.map(c => ({
      url: `${c.slug}|${c.id}`,
      title: c.title,
      thumbnailUrl: c.posterThumbnailUrl,
      lang: this.lang,
      author: c.authors.map(a => a.name).join(', '),
      description: c.longDescription,
    }));
    const linkHeader = res.headers['link'];
    return { mangas, hasNextPage: linkHeader != null };
  }

  private parseComics(res: any): SearchResult {
    const data: Comic[] = res.data;
    const accessible = data.filter(c => c.isAccessible);
    const mangas: Manga[] = accessible.map(c => ({
      url: `${c.slug}|${c.id}`,
      title: c.title,
      thumbnailUrl: c.posterThumbnailUrl,
      lang: this.lang,
      author: c.authors.map(a => a.name).join(', '),
      description: c.longDescription,
    }));
    return { mangas, hasNextPage: false };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    await this.ensureApiHeaders();
    const id = mangaUrl.split('|')[1];
    const res = await this.get(
      `${API_URL}/comics/${id}/chapters?locale=${this.lang}`,
      { headers: this.apiHeaders },
    );
    const data: Chapter[] = res.data;
    return data.filter(c => c.isAccessible).reverse().map(c => ({
      name: `${c.title}${c.subtitle ? ' - ' + c.subtitle : ''}${!c.isFree && !c.isUserUnlocked && !c.isUserRented ? ' 🔒' : ''}`,
      url: String(c.id),
      chapterNumber: c.order + 1,
      dateUpload: new Date(c.willAccessibleAt).getTime() || 0,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    await this.ensureApiHeaders();
    const res = await this.get(
      `${API_URL}/content-delivery/contents?chapterId=${chapterUrl}&variant=high&locale=${this.lang}`,
      { headers: this.apiHeaders },
    );
    const data: string[] = res.data;
    return data.map((url, i) => ({ index: i, imageUrl: url }));
  }
}
