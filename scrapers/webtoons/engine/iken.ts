import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

interface SearchResponse {
  posts: MangaItem[];
  totalCount: number;
}

interface MangaItem {
  id: number;
  slug: string;
  postTitle: string;
  postContent?: string;
  isNovel: boolean;
  featuredImage?: string;
  alternativeTitles?: string;
  author?: string;
  artist?: string;
  seriesType?: string;
  seriesStatus?: string;
  genres?: GenreItem[];
}

interface GenreItem {
  id: number;
  name: string;
}

interface Post<T> {
  post: T;
}

interface ChapterListResponse {
  isNovel?: boolean;
  slug?: string;
  id?: number;
  chapters: ChapterItem[];
}

interface ChapterItem {
  id: number;
  slug: string;
  number: string;
  title?: string;
  createdAt: string;
  chapterStatus: string;
  isAccessible: boolean;
  isLocked?: boolean;
  isTimeLocked?: boolean;
  mangaPost?: { slug?: string };
}

interface PageResponse {
  chapter: PageData;
}

interface PageData {
  id?: number;
  images: PageImage[];
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  isShortLinkLocked?: boolean;
}

interface PageImage {
  url: string;
  order?: number;
}

const NUMBER_REGEX = /\d+/;

export abstract class IkenScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected readonly apiUrl: string;
  protected readonly perPage = 18;
  protected sortPagesByFilename = false;

  constructor(name: string, baseUrl: string, lang: string, apiUrl?: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
    this.apiUrl = (apiUrl || baseUrl).replace(/\/$/, '');
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.apiUrl}/api/query?page=${page}&perPage=${this.perPage}&searchTerm=&orderBy=totalViews&orderDirection=desc`;
    const res = await this.get(url);
    return this.parseSearchResult(res.data, page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = `${this.apiUrl}/api/query?page=${page}&perPage=${this.perPage}&searchTerm=&orderBy=lastChapterAddedAt&orderDirection=desc`;
    const res = await this.get(url);
    return this.parseSearchResult(res.data, page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      try {
        const parsedUrl = new URL(query);
        const baseParsed = new URL(this.baseUrl);
        if (parsedUrl.host !== baseParsed.host) {
          throw new Error('Unsupported url');
        }
        const segments = parsedUrl.pathname.split('/').filter(Boolean);
        if (segments.length < 2) {
          throw new Error('Unsupported url');
        }
        const slug = segments[1];
        const details = await this.getMangaDetails(`${slug}#0`);
        const manga: Manga = {
          title: details.title || slug,
          url: `${slug}#0`,
          thumbnailUrl: details.thumbnailUrl || '',
          lang: this.lang,
          author: details.author,
          description: details.description,
        };
        return { mangas: [manga], hasNextPage: false };
      } catch (err) {
        console.error(`Failed to process URL ${query} on ${this.name}: ${err instanceof Error ? err.message : err}`);
        throw new Error('Unsupported url');
      }
    }

    const encodedQuery = encodeURIComponent(query.trim());
    const url = `${this.apiUrl}/api/query?page=${page}&perPage=${this.perPage}&searchTerm=${encodedQuery}`;
    const res = await this.get(url);
    return this.parseSearchResult(res.data, page);
  }

  protected parseSearchResult(data: SearchResponse, page: number): SearchResult {
    const mangas: Manga[] = data.posts
      .filter(p => !p.isNovel)
      .map(p => ({
        title: p.postTitle,
        url: `${p.slug}#${p.id}`,
        thumbnailUrl: p.featuredImage || '',
        lang: this.lang,
        author: p.author || undefined,
      }));
    const hasNextPage = data.totalCount > page * this.perPage;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.substring(0, mangaUrl.indexOf('#'));
    const res = await this.get(`${this.apiUrl}/api/post?postSlug=${slug}`);
    const data = res.data as Post<MangaItem>;
    return this.mangaDetailsParse(data.post);
  }

  protected mangaDetailsParse(manga: MangaItem): Partial<Manga> {
    const description = this.buildDescription(manga);
    const genres = this.buildGenres(manga);
    return {
      title: manga.postTitle,
      url: `${manga.slug}#${manga.id}`,
      thumbnailUrl: manga.featuredImage || '',
      lang: this.lang,
      author: manga.author || undefined,
      description: [description, genres].filter(Boolean).join('\n\n') || undefined,
    };
  }

  private stripHtml(html: string): string {
    return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  }

  private buildDescription(manga: MangaItem): string {
    const parts: string[] = [];
    if (manga.postContent) {
      const desc = this.stripHtml(manga.postContent).trim();
      if (desc) parts.push(desc);
    }
    if (manga.alternativeTitles) {
      parts.push(`Alternative Names: ${manga.alternativeTitles}`);
    }
    return parts.join('\n\n');
  }

  private buildGenres(manga: MangaItem): string {
    const list: string[] = [];
    switch (manga.seriesType) {
      case 'MANGA': list.push('Manga'); break;
      case 'MANHUA': list.push('Manhua'); break;
      case 'MANHWA': list.push('Manhwa'); break;
    }
    if (manga.genres) {
      manga.genres.forEach(g => list.push(g.name));
    }
    return [...new Set(list)].join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.substring(0, mangaUrl.indexOf('#'));
    const res = await this.get(`${this.apiUrl}/api/post?postSlug=${slug}`);
    const data = res.data as Post<ChapterListResponse>;
    return data.post.chapters
      .filter(ch => ch.chapterStatus === 'PUBLIC' && ch.isAccessible)
      .map(ch => this.chapterFromApi(ch, data.post.slug || slug));
  }

  protected chapterFromApi(ch: ChapterItem, mangaSlug: string): Chapter {
    const prefix = ch.isAccessible ? '' : '\u{1F512} ';
    const suffix = ch.title ? ` - ${ch.title}` : '';
    const seriesSlug = ch.mangaPost?.slug || mangaSlug;
    const name = `${prefix}Chapter ${ch.number}${suffix}`;
    return {
      name,
      url: `/series/${seriesSlug}/${ch.slug}#${ch.id}`,
      chapterNumber: parseFloat(ch.number),
      dateUpload: new Date(ch.createdAt).getTime() || undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.substring(chapterUrl.lastIndexOf('#') + 1);
    const res = await this.get(`${this.apiUrl}/api/chapter?chapterId=${id}`);
    const data = res.data as PageResponse;
    const pageData = data.chapter;

    if (pageData.isShortLinkLocked) {
      throw new Error('Chapter locked (short link)');
    }
    if (pageData.isLockedByCoins) {
      throw new Error('Chapter locked (coins required)');
    }
    if (pageData.isPermanentlyLocked) {
      throw new Error('Chapter permanently locked');
    }

    const sortedPages = this.sortPagesByFilename
      ? [...pageData.images].sort((a, b) => {
          const numA = parseInt(a.url.match(NUMBER_REGEX)?.[0] || '999999', 10);
          const numB = parseInt(b.url.match(NUMBER_REGEX)?.[0] || '999999', 10);
          return numA - numB;
        })
      : [...pageData.images].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

    return sortedPages.map((img, index) => ({
      index,
      imageUrl: img.url.replace(/ /g, '%20'),
    }));
  }
}
