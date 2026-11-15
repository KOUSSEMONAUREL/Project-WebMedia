import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Json } from '../../../engine/nextjs';

interface ComicDto {
  slug: string;
  title: string;
  cover?: string | null;
  status?: string | null;
  views?: number;
  lastUpdated?: string | null;
  genres?: string | null;
  publisher?: string | null;
  issueCount?: number;
}

interface CatalogueDto {
  comics: ComicDto[];
}

interface BrowseDto {
  comics: ComicDto[];
  hasMore: boolean;
}

interface SeriesDto {
  name?: string;
  image?: string | null;
  description?: string | null;
  author?: { name?: string };
  illustrator?: { name?: string };
  publisher?: { name?: string };
  genre?: string[];
}

interface IssueDto {
  title: string;
  slug: string;
  releaseDate?: string | null;
}

interface IssuesDto {
  issues: IssueDto[];
}

interface PageDto {
  url: string;
}

interface PagesDto {
  pages: PageDto[];
}

const LATEST_LIMIT = 20;

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    default: return 3;
  }
}

export class ReadComicsOnlineLolScraper extends BaseScraper {
  readonly name = 'ReadComicsOnline';
  readonly baseUrl = 'https://readcomicsonline.lol';
  readonly lang = 'en';

  private cataloguePromise?: Promise<ComicDto[]>;

  private loadCatalogue(): Promise<ComicDto[]> {
    if (!this.cataloguePromise) {
      this.cataloguePromise = this.fetchCatalogue().catch(error => {
        this.cataloguePromise = undefined;
        throw error;
      });
    }
    return this.cataloguePromise;
  }

  private async fetchCatalogue(): Promise<ComicDto[]> {
    const res = await this.get('/comics');
    const value = extractNextJsHtml(
      String(res.data),
      json => isJsonObject(json) && Array.isArray(json.comics) && json.comics.length > 0,
    );
    if (!value || !isJsonObject(value) || !Array.isArray(value.comics)) return [];
    return value.comics as unknown as ComicDto[];
  }

  private toManga(comic: ComicDto): Manga {
    return {
      title: comic.title,
      url: this.absUrl(`/comic/${comic.slug}`),
      thumbnailUrl: comic.cover ?? '',
      lang: this.lang,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const comics = await this.loadCatalogue();
    return { mangas: comics.map(comic => this.toManga(comic)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({
      tab: 'latest',
      offset: String((page - 1) * LATEST_LIMIT),
      limit: String(LATEST_LIMIT),
    });
    const res = await this.get(`/api/comics/browse?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as BrowseDto;
    return {
      mangas: (data.comics ?? []).map(comic => this.toManga(comic)),
      hasNextPage: Boolean(data.hasMore),
    };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    if (!term) return this.getPopular();
    const comics = await this.loadCatalogue();
    return {
      mangas: comics
        .filter(comic => comic.title.toLowerCase().includes(term))
        .map(comic => this.toManga(comic)),
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const url = this.absUrl(mangaUrl);
    const res = await this.get(url);
    const $ = this.$(String(res.data));
    const series = this.readSeries($);
    if (!series) return { url };

    return {
      title: series.name || undefined,
      url,
      thumbnailUrl: series.image ?? undefined,
      author: series.author?.name || undefined,
      artist: series.illustrator?.name || undefined,
      genre: series.genre?.join(', ') || undefined,
      description: series.description || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.absUrl(mangaUrl);
    const res = await this.get(url);
    const value = extractNextJsHtml(
      String(res.data),
      json => isJsonObject(json) && Array.isArray(json.issues) && json.issues.length > 0,
    );
    if (!value || !isJsonObject(value) || !Array.isArray(value.issues)) return [];

    const issues = value.issues as unknown as IssueDto[];
    return issues.map(issue => {
      const date = issue.releaseDate ? Date.parse(issue.releaseDate) : Number.NaN;
      const number = /#(\d+(?:\.\d+)?)/.exec(issue.title);
      return {
        name: issue.title,
        url: `${url.replace(/\/+$/, '')}/${issue.slug}`,
        chapterNumber: number ? Number.parseFloat(number[1]) : undefined,
        dateUpload: Number.isNaN(date) ? undefined : date,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const value = extractNextJsHtml(
      String(res.data),
      json => isJsonObject(json) && Array.isArray(json.pages) && json.pages.length > 0,
    );
    if (!value || !isJsonObject(value) || !Array.isArray(value.pages)) return [];

    const pages = value.pages as unknown as PageDto[];
    return pages
      .filter(page => typeof page.url === 'string')
      .map((page, index) => ({ index, imageUrl: page.url }));
  }

  private readSeries($: ReturnType<BaseScraper['$']>): SeriesDto | undefined {
    const scripts = $('script[type="application/ld+json"]').toArray();
    for (const script of scripts) {
      const text = $(script).text();
      if (!text.includes('"ComicSeries"')) continue;
      try {
        const parsed = JSON.parse(text) as Json;
        if (!isJsonObject(parsed)) continue;
        return parsed as unknown as SeriesDto;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}
