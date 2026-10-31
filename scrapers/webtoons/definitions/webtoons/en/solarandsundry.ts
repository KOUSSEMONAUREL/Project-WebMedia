import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface SasPage {
  page_number: number;
  image_url: string;
  thumbnail_url?: string;
  name: string;
  published_at: string;
}

const TITLE = 'Solar and Sundry';
const ARCHIVE_URL = 'https://sas.ewanb.me';

export class SolarAndSundryScraper extends BaseScraper {
  readonly name = 'Solar and Sundry';
  readonly baseUrl = 'https://sas-api.fly.dev';
  readonly lang = 'en';

  async getPopular(): Promise<SearchResult> {
    return { mangas: [this.manga()], hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const matches = query.trim().length > 0 && TITLE.toLowerCase().includes(query.trim().toLowerCase());
    return { mangas: matches ? [this.manga()] : [], hasNextPage: false };
  }

  private manga(): Manga {
    return {
      title: TITLE,
      url: ARCHIVE_URL,
      thumbnailUrl: 'https://imagedelivery.net/zthi1l8fKrUGB5ig08mq-Q/de292ba7-f164-4f43-ec17-1876a7a44600/public',
      author: 'Ewan Breakey',
      artist: 'Ewan Breakey',
      description: 'a sci-fi horror webcomic about life blooming against all odds',
      status: 1,
      lang: this.lang,
    };
  }

  async getMangaDetails(): Promise<Partial<Manga>> {
    return {
      title: TITLE,
      author: 'Ewan Breakey',
      artist: 'Ewan Breakey',
      description: 'a sci-fi horror webcomic about life blooming against all odds',
      thumbnailUrl: 'https://imagedelivery.net/zthi1l8fKrUGB5ig08mq-Q/de292ba7-f164-4f43-ec17-1876a7a44600/public',
      status: 1,
      lang: this.lang,
    };
  }

  async getChapterList(): Promise<Chapter[]> {
    const res = await this.get(`${this.baseUrl}/page`);
    const pages = Array.isArray(res.data) ? res.data as SasPage[] : [];
    return pages
      .map(page => ({
        name: page.name,
        url: `${this.baseUrl}/page/${page.page_number}`,
        chapterNumber: page.page_number,
        dateUpload: page.published_at ? Date.parse(page.published_at) : undefined,
      }))
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const page = res.data as SasPage;
    if (!page.image_url) return [];
    return [{ index: 0, imageUrl: page.image_url }];
  }
}
