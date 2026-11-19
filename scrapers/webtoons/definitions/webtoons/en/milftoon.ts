import { BaseScraper } from '../../../engine/base';
import type { Manga, MangaStatus, Chapter, Page, SearchResult } from '../../../engine/types';

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

interface MilftoonTerm {
  name: string;
}

interface MilftoonComic {
  title: string;
  coverPath?: string;
}

interface MilftoonChapter {
  slug?: string | null;
}

interface MilftoonChapterItem {
  slug: string;
  name: string;
  nameExtend?: string | null;
  publishedAt?: string | null;
}

interface MilftoonPage {
  src: string;
}

interface MilftoonDetailData {
  comic?: MilftoonComic;
  chapter?: MilftoonChapter | null;
  pages: MilftoonPage[];
}

interface MilftoonComicDetail {
  title: string;
  coverPath?: string | null;
  synopsisHtml?: string | null;
  status?: string | null;
  author?: string | null;
  genres: MilftoonTerm[];
  tags: MilftoonTerm[];
  chapters: MilftoonChapterItem[];
}

interface MilftoonDetailWrapper {
  data: MilftoonDetailData;
  auxiliary: MilftoonComicDetail;
}

interface MilftoonPageWrapper {
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

  private relativePath(url: string): string {
    return url.startsWith('http') ? new URL(url).pathname : url;
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

  private async getMangaList(orderBy: string, page: number): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/manga_list/all`);
    url.searchParams.set('orderby', orderBy);
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    return this.parseList(String(res.data));
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getMangaList('views', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getMangaList('latest', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim() === '') return this.getLatest(page);
    const url = new URL(`${this.baseUrl}/search_result`);
    url.searchParams.set('keyword', query.trim());
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    return this.parseList(String(res.data));
  }

  private statusToManga(status: string | null | undefined): MangaStatus {
    if (status === 'ongoing') return 1;
    if (status === 'end') return 0;
    return 3;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const wrapper = JSON.parse(this.extractRouteData(String(res.data))) as MilftoonDetailWrapper;
    const comic = wrapper.auxiliary;
    const genres = [...new Set([...(comic.genres ?? []), ...(comic.tags ?? [])]
      .map(term => term.name)
      .filter(Boolean))];
    return {
      title: comic.title,
      url: this.relativePath(mangaUrl),
      thumbnailUrl: comic.coverPath ? this.cdnUrl + comic.coverPath : '',
      author: comic.author || undefined,
      description: comic.synopsisHtml ? this.$(comic.synopsisHtml).text().trim() || undefined : undefined,
      genre: genres.join(', ') || undefined,
      status: this.statusToManga(comic.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const wrapper = JSON.parse(this.extractRouteData(String(res.data))) as MilftoonDetailWrapper;
    const comic = wrapper.auxiliary;
    const landingSlug = wrapper.data.chapter?.slug;
    const basePath = this.relativePath(mangaUrl);

    const chapters = (comic.chapters ?? []).map(chapter => {
      const name = [chapter.name, chapter.nameExtend]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(' ');
      const dateUpload = chapter.publishedAt ? Date.parse(chapter.publishedAt) : Number.NaN;
      return {
        name: name || 'Chapter',
        url: chapter.slug === landingSlug ? basePath : `${basePath}/${chapter.slug}`,
        dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
      } as Chapter;
    });

    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const wrapper = JSON.parse(this.extractRouteData(String(res.data))) as MilftoonPageWrapper;
    return wrapper.data.pages.map((p, i) => ({
      index: i,
      imageUrl: p.src,
    }));
  }
}
