import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface BrowseManga {
  slug: string;
  title: string;
  coverUrl: string;
}

interface BrowseResponse {
  data: BrowseManga[];
  totalPages?: number;
}

interface MangaDetails {
  title: string;
  coverUrl: string;
  description?: string | null;
  genres?: string[];
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  type?: string | null;
}

interface ChapterResponse {
  chapters: Array<{
    chapterNumber: number;
    title?: string | null;
    createdAt?: string | null;
  }>;
  totalPages: number;
}

interface ChapterImages {
  images: string[];
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    default: return undefined;
  }
}

export class ToongrabScraper extends BaseScraper {
  readonly name = 'Toongrab';
  readonly baseUrl = 'https://toongrab.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse('Most Popular', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(undefined, page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/manga/browse`);
    url.searchParams.set('search', query);
    url.searchParams.set('page', String(page));
    return this.browseUrl(url.toString(), page);
  }

  private async browse(sort: string | undefined, page: number): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/manga/browse`);
    url.searchParams.set('page', String(page));
    if (sort) url.searchParams.set('sort', sort);
    return this.browseUrl(url.toString(), page);
  }

  private async browseUrl(url: string, page: number): Promise<SearchResult> {
    const res = await this.get(url);
    const data = res.data as BrowseResponse;
    const mangas = (data.data ?? []).map(item => ({
      title: item.title,
      url: `${this.baseUrl}/manga/${item.slug}`,
      thumbnailUrl: item.coverUrl ?? '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: page < (data.totalPages ?? page) };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slug(mangaUrl);
    if (!slug) return {};
    const res = await this.get(`${this.baseUrl}/api/manga/${slug}`);
    const data = res.data as MangaDetails;
    return {
      title: data.title,
      thumbnailUrl: data.coverUrl,
      description: data.description ?? undefined,
      author: data.author ?? undefined,
      artist: data.artist ?? undefined,
      genre: [...(data.genres ?? []), ...(data.type ? [data.type] : [])].join(', ') || undefined,
      status: parseStatus(data.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slug(mangaUrl);
    if (!slug) return [];
    const first = await this.fetchChapters(slug, 1);
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, i) => this.fetchChapters(slug, i + 2)),
    );
    return [first, ...rest]
      .flatMap(data => data.chapters)
      .map(ch => {
        const number = Number(ch.chapterNumber);
        const label = number.toString();
        return {
          name: `Chapter ${label}` + (ch.title ? ` - ${ch.title}` : ''),
          url: `${this.baseUrl}/manga/${slug}/chapter-${label}`,
          chapterNumber: number,
          dateUpload: ch.createdAt ? Date.parse(ch.createdAt) : undefined,
        };
      });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = new URL(chapterUrl, this.baseUrl).pathname.split('/').filter(Boolean);
    const slug = parts[1];
    const number = parts[2]?.replace(/^chapter-/, '');
    if (!slug || !number) return [];
    const res = await this.get(`${this.baseUrl}/api/manga/${slug}/chapter/${number}`);
    const data = res.data as ChapterImages;
    return (data.images ?? []).map((imageUrl, index) => ({ index, imageUrl }));
  }

  private async fetchChapters(slug: string, page: number): Promise<ChapterResponse> {
    const res = await this.get(`${this.baseUrl}/api/manga/${slug}/chapters?limit=100&page=${page}`);
    const data = res.data as ChapterResponse;
    return {
      chapters: Array.isArray(data.chapters) ? data.chapters : [],
      totalPages: data.totalPages ?? 1,
    };
  }

  private slug(url: string): string | undefined {
    try {
      const parts = new URL(url, this.baseUrl).pathname.split('/').filter(Boolean);
      return parts[1];
    } catch {
      return undefined;
    }
  }
}
