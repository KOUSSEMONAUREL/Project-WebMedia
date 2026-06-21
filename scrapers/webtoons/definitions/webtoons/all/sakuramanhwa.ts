import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface MangaDetails {
  id: string;
  title: string;
  img: string;
  description?: string;
  language: string;
  slug: string;
  type: string;
  status?: string;
  authors?: string[];
  rating?: number;
  create_at?: string;
}

interface ChapterInfo {
  id: string;
  title?: string;
  create_at: string;
  number: number;
}

interface ApiMangaInfo {
  manga: MangaDetails;
  metaData: { follows: number; views: number };
  chapters: ChapterInfo[];
}

interface ApiChapterInfo {
  chapter: { id: string; number: number; title?: string; images: string[][] };
}

interface ApiMangaList {
  mangas: MangaDetails[];
  next_page?: number;
}

const dateFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export class BlossomManhwaScraper extends BaseScraper {
  readonly name = 'BlossomManhwa';
  readonly baseUrl = 'https://api.cherrymanhwa.com';
  readonly lang = 'all';

  private siteUrl = 'https://cherrymanhwa.com';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.focusFetch(page, () =>
      this.get(`/v1/manga/views/top?limit=72&page=${page}`),
    );
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.focusFetch(page, () =>
      this.get('/v1/manga/search/latesUpdates?limit=72&page=${page}'),
    );
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.focusFetch(page, () =>
      this.get(`/v1/manga?search=${encodeURIComponent(query)}&limit=50&page=${page}`, {
        headers: { Referer: `${this.siteUrl}/` },
      }),
    );
  }

  private async focusFetch(page: number, reqFn: () => Promise<any>): Promise<SearchResult> {
    let res = await reqFn();
    const data: ApiMangaList = res.data;
    const mangas = data.mangas.map(m => this.toManga(m));
    return { mangas, hasNextPage: data.next_page != null };
  }

  private toManga(details: MangaDetails): Manga {
    return {
      url: `/v1/manga/findBySlug/${details.slug}`,
      title: this.capitalizeTitle(details.title.replace(details.language, '').trim()),
      thumbnailUrl: `${this.baseUrl}/v1/images/manga${details.img}`,
      lang: this.lang,
      author: details.authors?.join(', ') || '',
      description: details.description || '',
    };
  }

  private capitalizeTitle(str: string): string {
    return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl, {
      headers: { Referer: `${this.siteUrl}/` },
    });
    const data: ApiMangaInfo = res.data;
    return data.chapters.map(c => ({
      name: `${this.getChapterName(c.number)}${c.title ? ' ' + c.title : ''}`,
      url: `/v1/manga/${data.manga.slug}/chapter/${this.getChapterName(c.number)}`,
      chapterNumber: c.number,
      dateUpload: this.parseDate(c.create_at),
    }));
  }

  private getChapterName(number: number): string {
    return number % 1 === 0 ? String(Math.floor(number)) : String(number);
  }

  private parseDate(str: string): number | undefined {
    if (!dateFormat.test(str)) return undefined;
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl, {
      headers: { Referer: `${this.siteUrl}/` },
    });
    const data: ApiChapterInfo = res.data;
    const longestSet = data.chapter.images.reduce((a, b) => a.length > b.length ? a : b, data.chapter.images[0] || []);
    return longestSet.map((path, i) => ({
      index: i,
      imageUrl: `/chapter${path}`,
    }));
  }
}
