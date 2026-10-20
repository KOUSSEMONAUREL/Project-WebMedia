import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface MilftoonItem {
  title: string;
  author?: string;
  slug: string;
  coverPath?: string;
}

interface MilftoonListData {
  items: MilftoonItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface MilftoonListWrapper {
  data: MilftoonListData;
}

interface MilftoonComic {
  title: string;
  coverPath?: string;
}

interface MilftoonChapter {
  name: string;
  publishedAt: string;
}

interface MilftoonPage {
  src: string;
}

interface MilftoonDetailData {
  comic: MilftoonComic;
  chapter?: MilftoonChapter | null;
  pages: MilftoonPage[];
}

interface MilftoonDetailWrapper {
  data: MilftoonDetailData;
}

export class MilftoonScraper extends BaseScraper {
  readonly name = 'Milftoon';
  readonly baseUrl = 'https://milftoon.xxx';
  readonly lang = 'en';

  private readonly cdnUrl = 'https://fdc1.azhentai.com/';

  private extractRouteData(html: string): string {
    const marker = 'window.__INITIAL_ROUTE_DATA__=';
    const start = html.indexOf(marker);
    if (start < 0) throw new Error('Route data not found');
    const braceStart = html.indexOf('{', start);
    if (braceStart < 0) throw new Error('Route data not found');
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = braceStart; i < html.length; i++) {
      const c = html[i];
      if (inString && escaped) { escaped = false; continue; }
      if (inString && c === '\\') { escaped = true; continue; }
      if (inString && c === '"') { inString = false; continue; }
      if (!inString && c === '"') { inString = true; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) throw new Error('Route data not found');
    return html.slice(braceStart, end);
  }

  private parseList(html: string): { mangas: Manga[]; hasNextPage: boolean } {
    const wrapper = JSON.parse(this.extractRouteData(html)) as MilftoonListWrapper;
    const data = wrapper.data;
    const mangas: Manga[] = data.items.map(item => ({
      title: item.title,
      author: item.author,
      url: `/comics/${item.slug}`,
      thumbnailUrl: item.coverPath ? this.cdnUrl + item.coverPath : '',
      lang: this.lang,
    }));
    const hasNextPage = data.page * data.pageSize < data.total;
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/ranking/hottest?page=${page}`);
    const parsed = this.parseList(String(res.data));
    return parsed;
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/manga_list/all?page=${page}`);
    const parsed = this.parseList(String(res.data));
    return parsed;
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim() === '') return this.getLatest(page);
    const url = new URL(`${this.baseUrl}/search_result`);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    const parsed = this.parseList(String(res.data));
    return parsed;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const wrapper = JSON.parse(this.extractRouteData(String(res.data))) as MilftoonDetailWrapper;
    const data = wrapper.data;
    const comic = data.comic;
    return {
      title: comic.title,
      url: mangaUrl.startsWith('http') ? new URL(mangaUrl).pathname : mangaUrl,
      thumbnailUrl: comic.coverPath ? this.cdnUrl + comic.coverPath : '',
      author: undefined,
      description: (res.data as string).match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)?.[1],
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const wrapper = JSON.parse(this.extractRouteData(String(res.data))) as MilftoonDetailWrapper;
    const data = wrapper.data;
    const chapter = data.chapter;
    if (!chapter) return [];
    const dateUpload = Date.parse(chapter.publishedAt);
    const relUrl = mangaUrl.startsWith('http') ? new URL(mangaUrl).pathname : mangaUrl;
    return [{
      name: chapter.name || 'Chapter',
      url: relUrl,
      dateUpload: isNaN(dateUpload) ? undefined : dateUpload,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const wrapper = JSON.parse(this.extractRouteData(String(res.data))) as MilftoonDetailWrapper;
    const data = wrapper.data;
    return data.pages.map((p, i) => ({
      index: i,
      imageUrl: p.src,
    }));
  }
}
