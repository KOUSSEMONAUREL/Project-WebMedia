import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const ORIGIN = 'https://www.izneo.com';
const LIMIT = 50;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}/;

interface Series {
  name: string;
  url: string;
  id: string;
  version: number;
  synopsis: string;
  gender: string;
  target: { name: string };
  authors: { nickname: string }[];
}

interface Album {
  id: string;
  title: string;
  chapter: string;
  publicationDate: string;
  fullAvailable: boolean;
  inUserLibrary: boolean;
  inUserSubscription: boolean;
}

interface AlbumPage {
  albumPageNumber: number;
  key: string;
  iv: string;
}

export class IzneoScraper extends BaseScraper {
  readonly name = 'izneo';
  readonly baseUrl = `${ORIGIN}/all/webtoon`;
  readonly lang = 'all';

  private apiUrl = `${ORIGIN}/all/api/catalog/detail/webtoon`;

  private getApiHeaders(): Record<string, string> {
    return {
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: 'lang=all;',
      Referer: this.baseUrl,
    };
  }

  async getPopular(page: number): Promise<SearchResult> {
    const url = `${this.apiUrl}/topSales?offset=${page - 1}&order=0&abo=0`;
    const res = await this.get(url, this.getApiHeaders());
    return this.parseListResponse(res);
  }

  async getLatest(page: number): Promise<SearchResult> {
    const url = `${this.apiUrl}/new?offset=${page - 1}&order=1&abo=0`;
    const res = await this.get(url, this.getApiHeaders());
    return this.parseListResponse(res);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const p = page ?? 1;
    const url = `${this.apiUrl}/free?offset=${p - 1}&order=3&abo=0`;
    const res = await this.get(url, this.getApiHeaders());
    const result = await this.parseListResponse(res);
    result.mangas = result.mangas.filter(m => m.title?.toLowerCase().includes(query.toLowerCase()));
    return result;
  }

  async getMangaDetail(mangaUrl: string): Promise<Manga> {
    return {
      title: mangaUrl,
      url: mangaUrl,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('-').pop() ?? '';
    const chapters: Chapter[] = [];
    let cutoff = 0;
    let current = LIMIT;
    while (current === LIMIT) {
      const url = `${ORIGIN}/all/api/web/serie/${id}/chapters/old/${cutoff}/${LIMIT}`;
      const res = await this.get(url, this.getApiHeaders());
      const data = this.parseResponse(res);
      const albums: Album[] = data.albums ?? [];
      for (const album of albums) {
        chapters.push({
          url: mangaUrl + this.getAlbumPath(album),
          name: this.albumToString(album),
          chapterNumber: parseFloat(album.chapter) || 0,
          date: this.parseDate(album.publicationDate),
        });
      }
      cutoff += LIMIT;
      current = albums.length;
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('-').pop()?.split('/')[0] ?? '';
    const res = await this.get(`${ORIGIN}/book/${chapterId}`, this.getApiHeaders());
    const data = this.parseResponse(res).data;
    const pages: AlbumPage[] = data.pages ?? [];
    return pages.map((page: AlbumPage) => ({
      index: page.albumPageNumber,
      url: chapterId + this.albumPageToString(page),
      imageUrl: '',
    }));
  }

  private parseListResponse(res: any): SearchResult {
    const json = this.parseResponseObj(res.data);
    if (!json) return { mangas: [], hasNextPage: false };

    const seriesCount: number = json.series_count;
    if (seriesCount == null) return { mangas: [], hasNextPage: false };

    const seriesObj = json.series ?? {};
    let seriesList: Series[] = [];
    for (const key of Object.keys(seriesObj)) {
      const items = seriesObj[key] as Series[];
      seriesList = seriesList.concat(items);
    }

    const mangas: Manga[] = seriesList.map((s: Series) => ({
      url: s.url,
      title: s.name,
      genres: `${s.gender}, ${s.target?.name ?? ''}`,
      author: s.authors?.map((a: any) => a.nickname).join(', ') ?? undefined,
      artist: s.authors?.map((a: any) => a.nickname).join(', ') ?? undefined,
      thumbnail: `${ORIGIN}/all${this.getCover(s)}`,
      description: s.synopsis?.replace(/\n\s+/g, ' ').replace(/<br\s*\/?>/gi, '') ?? undefined,
    }));

    return { mangas, hasNextPage: false };
  }

  private getCover(series: Series): string {
    return `/images/serie/${series.id}.jpg?v=${series.version}`;
  }

  private getAlbumPath(album: Album): string {
    return `/episode-${album.chapter}-${album.id}/read/1`;
  }

  private albumToString(album: Album): string {
    const isLocked = !album.fullAvailable && !(album.inUserLibrary || album.inUserSubscription);
    return album.title + (isLocked ? ' 🔒' : '');
  }

  private albumPageToString(page: AlbumPage): string {
    const key = page.key.replace(/\+/g, '-').replace(/\//g, '_');
    const iv = page.iv.replace(/\+/g, '-').replace(/\//g, '_');
    return `/${page.albumPageNumber}?type=full&key=${key}&iv=${iv}`;
  }

  private parseResponse(res: any): any {
    const json = this.parseResponseObj(res.data);
    if (json.status === 'error') {
      const code = json.code;
      if (code === '4') throw new Error('You are not authorized to view this');
      throw new Error(json.data ?? 'Unknown error');
    }
    return json;
  }

  private parseResponseObj(data: any): any {
    if (typeof data === 'string') return JSON.parse(data);
    return data;
  }

  private parseDate(dateStr: string): number {
    const m = dateStr.match(DATE_REGEX);
    if (!m) return 0;
    return Date.parse(m[0]);
  }
}
