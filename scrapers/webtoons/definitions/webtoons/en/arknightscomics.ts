import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface ComicRow {
  name: string;
  bigImage: string[];
  smallImage: string[];
  comicDescribe: string;
  latestChapter: number;
}

interface ListResponse {
  data: {
    rows: ComicRow[];
  };
}

interface ChapterRow {
  chapter: number;
  publishTime: number;
  detailsContent: string[];
}

interface DetailsResponse {
  data: {
    rows: ChapterRow[];
  };
}

const BASE_WEB = 'https://arknights.global';
const LIST_PATH = '/api/resource/comic/list';
const DETAILS_PATH = '/api/resource/comic/details';

export class ArknightscomicsScraper extends BaseScraper {
  readonly name = 'ArknightsComics';
  readonly baseUrl = BASE_WEB;
  readonly lang = 'en';

  private async fetchComics(): Promise<ComicRow[]> {
    const res = await this.get(`${BASE_WEB}${LIST_PATH}`, {
      headers: { Accept: 'application/json, text/plain, */*', Referer: `${BASE_WEB}/` },
    });
    return (res.data as ListResponse).data.rows || [];
  }

  private async fetchChapters(name: string, chapter: number): Promise<ChapterRow[]> {
    const url = new URL(`${BASE_WEB}${DETAILS_PATH}`);
    url.searchParams.set('name', name);
    url.searchParams.set('index', '1');
    url.searchParams.set('size', '9999');
    if (chapter > 0) url.searchParams.set('chapter', String(chapter));
    const res = await this.get(url.toString(), {
      headers: { Accept: 'application/json, text/plain, */*', Referer: `${BASE_WEB}/` },
    });
    return (res.data as DetailsResponse).data.rows || [];
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.buildList(await this.fetchComics(), page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const rows = await this.fetchComics();
    const filtered = query.trim()
      ? rows.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase()))
      : rows;
    return this.buildList(filtered, page);
  }

  private buildList(rows: ComicRow[], page: number): SearchResult {
    const perPage = 20;
    const start = (page - 1) * perPage;
    const slice = rows.slice(start, start + perPage);
    const mangas: Manga[] = slice.map(row => ({
      title: row.name,
      url: `${BASE_WEB}/comic?name=${encodeURIComponent(row.name)}`,
      thumbnailUrl: row.bigImage?.[0] || row.smallImage?.[0] || '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: start + perPage < rows.length };
  }

  private comicNameFromUrl(mangaUrl: string): string {
    const name = new URLSearchParams(mangaUrl.split('?')[1] || '').get('name');
    if (!name) throw new Error(`Invalid manga url: ${mangaUrl}`);
    return name;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const name = this.comicNameFromUrl(mangaUrl);
    const rows = await this.fetchComics();
    const row = rows.find(r => r.name === name);
    if (!row) throw new Error(`Comic not found: ${name}`);
    return {
      title: row.name,
      url: mangaUrl,
      thumbnailUrl: row.bigImage?.[0] || row.smallImage?.[0] || '',
      description: row.comicDescribe || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const name = this.comicNameFromUrl(mangaUrl);
    const rows = await this.fetchChapters(name, 0);
    return rows
      .filter(r => r.detailsContent?.length)
      .sort((a, b) => b.chapter - a.chapter)
      .map(row => ({
      name: `Chapter ${row.chapter}`,
      url: `${BASE_WEB}/comic-detail?name=${encodeURIComponent(name)}&chapter=${row.chapter}`,
      chapterNumber: row.chapter,
      dateUpload: row.publishTime || undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const params = new URLSearchParams(chapterUrl.split('?')[1] || '');
    const name = params.get('name');
    const chapter = parseInt(params.get('chapter') || '0', 10);
    if (!name || !chapter) return [];
    const rows = await this.fetchChapters(name, chapter);
    const row = rows.find(r => r.chapter === chapter);
    if (!row) return [];
    return (row.detailsContent || []).map((img, i) => ({ imageUrl: img, index: i }));
  }
}

export default ArknightscomicsScraper;
