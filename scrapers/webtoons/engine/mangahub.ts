import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

interface HubSearchResponse {
  data: {
    search: {
      rows: HubSearchItem[];
    };
  };
}

interface HubSearchItem {
  title: string;
  slug: string;
  image: string;
  author: string;
  latestChapter: number;
  genres: string;
}

interface HubMangaResponse {
  data: {
    manga: HubMangaData;
  };
}

interface HubMangaData {
  title?: string;
  status?: string;
  image?: string;
  author?: string;
  artist?: string;
  genres?: string;
  description?: string;
  alternativeTitle?: string;
  slug?: string;
  chapters?: HubChapterItem[];
}

interface HubChapterItem {
  number: number;
  title: string;
  date: string;
}

interface HubChapterResponse {
  data: {
    chapter: HubChapterPageData;
  };
}

interface HubChapterPageData {
  pages: string;
  mangaID: number;
  number: number;
  manga: { slug: string };
}

interface HubPages {
  p: string;
  i: string[];
}

const SPACE_REGEX = /\s+/;

export abstract class MangaHubScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected readonly mangaSource: string;
  protected readonly baseApiUrl = 'https://api.mghcdn.com';
  protected readonly baseCdnUrl = 'https://imgx.mghcdn.com';
  protected readonly baseThumbCdnUrl = 'https://thumb.mghcdn.com';

  protected mhubAccess?: string;

  constructor(name: string, baseUrl: string, lang: string, mangaSource: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
    this.mangaSource = mangaSource;
  }

  protected async graphql(query: string): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: this.baseUrl,
    };
    if (this.mhubAccess) {
      headers['x-mhub-access'] = this.mhubAccess;
    }
    const res = await this.post(`${this.baseApiUrl}/graphql`, { query }, { headers });
    return res.data;
  }

  private querySearch(query: string, genre: string, order: string, page: number): string {
    const escapedQuery = query.replace(/"/g, '\\"');
    return `{ search(x: ${this.mangaSource}, q: "${escapedQuery}", genre: "${genre}", mod: ${order}, offset: ${(page - 1) * 30}) { rows { title, author, slug, image, genres, latestChapter } } }`;
  }

  private queryMangaDetails(slug: string): string {
    return `{ manga(x: ${this.mangaSource}, slug: "${slug}") { title, slug, status, image, author, artist, genres, description, alternativeTitle } }`;
  }

  private queryChapterList(slug: string): string {
    return `{ manga(x: ${this.mangaSource}, slug: "${slug}") { slug, chapters { number, title, date } } }`;
  }

  private queryPages(slug: string, number: number): string {
    return `{ chapter(x: ${this.mangaSource}, slug: "${slug}", number: ${number}) { pages, mangaID, number, manga { slug } } }`;
  }

  private toSignature(item: HubSearchItem): string {
    return item.author + item.latestChapter + item.genres;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const query = this.querySearch('', 'all', 'POPULAR', page);
    const data = await this.graphql(query) as HubSearchResponse;
    return this.parseSearchResult(data, page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const query = this.querySearch('', 'all', 'LATEST', page);
    const data = await this.graphql(query) as HubSearchResponse;
    return this.parseSearchResult(data, page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const gqlQuery = this.querySearch(query, 'all', 'POPULAR', page);
    const data = await this.graphql(gqlQuery) as HubSearchResponse;
    return this.parseSearchResult(data, page);
  }

  protected parseSearchResult(data: HubSearchResponse, _page: number): SearchResult {
    const seen = new Set<string>();
    const mangas: Manga[] = [];
    for (const item of data.data.search.rows) {
      const sig = this.toSignature(item);
      if (seen.has(sig)) continue;
      seen.add(sig);
      mangas.push({
        title: item.title,
        url: `/manga/${item.slug}`,
        thumbnailUrl: `${this.baseThumbCdnUrl}/${item.image}`,
        lang: this.lang,
      });
    }
    const hasNextPage = data.data.search.rows.length === 30;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.replace('/manga/', '');
    const query = this.queryMangaDetails(slug);
    const data = await this.graphql(query) as HubMangaResponse;
    return this.parseMangaDetails(data, mangaUrl);
  }

  protected parseMangaDetails(data: HubMangaResponse, mangaUrl: string): Partial<Manga> {
    const m = data.data.manga;
    const title = m.title || '';
    const thumbnailUrl = m.image ? `${this.baseThumbCdnUrl}/${m.image}` : '';
    const description = [
      m.description || '',
      m.alternativeTitle ? `\n\nAlternative Name: ${m.alternativeTitle}` : '',
    ].join('').trim() || undefined;
    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      lang: this.lang,
      author: m.author || undefined,
      description,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace('/manga/', '');
    const query = this.queryChapterList(slug);
    const data = await this.graphql(query) as HubMangaResponse;
    const chapters = data.data.manga.chapters;
    if (!chapters) return [];
    return chapters.map(ch => this.chapterFromApi(ch, slug)).reverse();
  }

  protected chapterFromApi(ch: HubChapterItem, slug: string): Chapter {
    const numberString = ch.number % 1 === 0
      ? String(ch.number)
      : String(ch.number);
    const title = ch.title.trim().replace(SPACE_REGEX, ' ');
    const name = title
      ? (title.includes(numberString) ? title : `Chapter ${numberString} - ${title}`)
      : `Chapter ${numberString}`;
    return {
      name,
      url: `/${slug}/chapter-${ch.number}`,
      chapterNumber: ch.number,
      dateUpload: new Date(ch.date).getTime() || undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('/').filter(Boolean);
    const slug = parts[0];
    const numStr = parts[1]?.startsWith('chapter-') ? parts[1].substring('chapter-'.length) : '0';
    const number = parseFloat(numStr);
    const query = this.queryPages(slug, number);
    const data = await this.graphql(query) as HubChapterResponse;
    const pagesData = JSON.parse(data.data.chapter.pages) as HubPages;
    return pagesData.i.map((img, index) => ({
      index,
      imageUrl: `${this.baseCdnUrl}/${pagesData.p}${img}`,
    }));
  }
}
