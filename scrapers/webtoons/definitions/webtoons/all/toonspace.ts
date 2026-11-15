import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://master.toonspace.io/api';
const PAGE_SIZE = 24;
const LOCK = '🔒';

const GENRES: Record<string, string> = {
  romance: 'Romance',
  fantasy: 'Fantasy',
  action: 'Action',
  drama: 'Drama',
  thriller: 'Thriller',
  'sci-fi': 'Sci-Fi',
  mystery: 'Mystery',
  horror: 'Horror',
  supernatural: 'Supernatural',
  superhero: 'Superhero',
  comedy: 'Comedy',
  'boys-love': "BL (Boys' Love)",
  'girls-love': "GL (Girls' Love)",
};

interface ImageDto {
  url: string;
}

interface GenreDto {
  type: string;
}

interface ToonDto {
  title: string;
  urlSlug: string;
  description?: string;
  author?: string;
  isComplete?: boolean;
  image?: ImageDto;
  genres?: GenreDto[];
  episodesCount?: number;
}

interface LatestEpisodeDto {
  toon?: ToonDto;
}

interface EpisodeToonDto {
  documentId: string;
  title: string;
}

interface PageDto {
  url: string;
}

interface EpisodeDto {
  documentId: string;
  index: number;
  title: string;
  releasedAt?: string;
  pages?: PageDto[];
  toon: EpisodeToonDto;
}

interface PaginationDto {
  page: number;
  pageCount: number;
}

interface ListDto<T> {
  data?: T[];
  meta?: { pagination?: PaginationDto };
}

interface DataDto<T> {
  data?: T;
}

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

export class ToonSpaceScraper extends BaseScraper {
  readonly name = 'Toon Space';
  readonly baseUrl = 'https://toon.space';
  readonly lang = 'en';

  private api(path: string): URL {
    const url = new URL(`${API_URL}/${path}`);
    url.searchParams.set('locale', this.lang);
    return url;
  }

  private toManga(dto: ToonDto): Manga {
    return {
      title: dto.title,
      url: `${this.baseUrl}/t/${dto.urlSlug}`,
      thumbnailUrl: dto.image?.url ?? '',
      description: dto.description,
      author: dto.author,
      genre: dto.genres?.map(genre => GENRES[genre.type] ?? genre.type).join(', ') || undefined,
      status: dto.isComplete === true ? 0 : dto.isComplete === false ? 1 : 3,
      lang: this.lang,
    };
  }

  private toToon(dto: ToonDto): Manga {
    const manga = this.toManga(dto);
    manga.lang = this.lang;
    return manga;
  }

  private async getToons(url: URL): Promise<SearchResult> {
    const res = await this.client.get(url.toString(), { headers: { Accept: 'application/json' } });
    const data = parseJson<ListDto<ToonDto>>(res.data);
    const pagination = data.meta?.pagination;
    return {
      mangas: (data.data ?? []).filter(toon => toon.episodesCount !== 0).map(toon => this.toToon(toon)),
      hasNextPage: pagination ? pagination.page < pagination.pageCount : false,
    };
  }

  private async getToon(field: string, value: string): Promise<ToonDto | undefined> {
    const url = this.api('toons');
    url.searchParams.set(`filters[${field}][$eq]`, value);
    url.searchParams.set('populate[image][fields][0]', 'url');
    url.searchParams.set('populate[genres][fields][0]', 'type');
    const res = await this.client.get(url.toString(), { headers: { Accept: 'application/json' } });
    return parseJson<ListDto<ToonDto>>(res.data).data?.[0];
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = this.api('toons');
    url.searchParams.set('fields[0]', 'title');
    url.searchParams.set('fields[1]', 'urlSlug');
    url.searchParams.set('populate[image][fields][0]', 'url');
    url.searchParams.set('pagination[page]', String(page));
    url.searchParams.set('pagination[pageSize]', String(PAGE_SIZE));
    url.searchParams.set('sort[0]', 'viewsCount:desc');
    return this.getToons(url);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const url = this.api('episodes');
    url.searchParams.set('fields[0]', 'index');
    url.searchParams.set('populate[toon][fields][0]', 'title');
    url.searchParams.set('populate[toon][fields][1]', 'urlSlug');
    url.searchParams.set('populate[toon][populate][image][fields][0]', 'url');
    url.searchParams.set('sort[0]', 'releasedAt:desc');
    url.searchParams.set('pagination[pageSize]', '100');
    const res = await this.client.get(url.toString(), { headers: { Accept: 'application/json' } });
    const data = parseJson<ListDto<LatestEpisodeDto>>(res.data);
    const seen = new Set<string>();
    const mangas: Manga[] = [];
    for (const episode of data.data ?? []) {
      if (!episode.toon) continue;
      const manga = this.toToon(episode.toon);
      if (seen.has(manga.url)) continue;
      seen.add(manga.url);
      mangas.push(manga);
    }
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = this.api('toons');
    url.searchParams.set('fields[0]', 'title');
    url.searchParams.set('fields[1]', 'urlSlug');
    url.searchParams.set('populate[image][fields][0]', 'url');
    url.searchParams.set('pagination[page]', String(page));
    url.searchParams.set('pagination[pageSize]', String(PAGE_SIZE));
    url.searchParams.set('sort[0]', 'viewsCount:desc');
    if (query.trim()) url.searchParams.set('filters[title][$containsi]', query.trim());
    return this.getToons(url);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean)[1] ?? '';
    const toon = await this.getToon('urlSlug', slug);
    if (!toon) return {};
    return this.toManga(toon);
  }

  private async getChapters(slug: string): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const url = this.api('episodes');
      url.searchParams.set('filters[toon][urlSlug][$eq]', slug);
      url.searchParams.set('filters[index][$gte]', '0');
      url.searchParams.set('fields[0]', 'index');
      url.searchParams.set('fields[1]', 'title');
      url.searchParams.set('fields[2]', 'releasedAt');
      url.searchParams.set('populate[pages][fields][0]', 'url');
      url.searchParams.set('populate[toon][fields][0]', 'documentId');
      url.searchParams.set('populate[toon][fields][1]', 'title');
      url.searchParams.set('sort[0]', 'index:desc');
      url.searchParams.set('pagination[page]', String(page++));
      url.searchParams.set('pagination[pageSize]', '100');

      const res = await this.client.get(url.toString(), { headers: { Accept: 'application/json' } });
      const data = parseJson<ListDto<EpisodeDto>>(res.data);
      const pagination = data.meta?.pagination;
      hasNextPage = pagination ? pagination.page < pagination.pageCount : false;

      for (const episode of data.data ?? []) {
        const title = episode.title.replace(`${episode.toon.title} - `, '');
        const date = episode.releasedAt ? Date.parse(episode.releasedAt) : 0;
        chapters.push({
          name: (episode.pages ?? []).length === 0 ? `${LOCK} ${title}` : title,
          url: `${this.baseUrl}/r/${episode.toon.documentId}/${episode.documentId}/${episode.index}`,
          dateUpload: date || undefined,
        });
      }
    }

    return chapters;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean)[1] ?? '';
    if (!slug) return [];
    return this.getChapters(slug);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const segments = new URL(this.absUrl(chapterUrl)).pathname.split('/').filter(Boolean);
    const episodeId = segments[2] ?? '';
    if (!episodeId) return [];
    const url = this.api(`episodes/${episodeId}`);
    url.searchParams.set('populate[pages][fields][0]', 'url');
    const res = await this.client.get(url.toString(), { headers: { Accept: 'application/json' } });
    const data = parseJson<DataDto<{ pages?: PageDto[] }>>(res.data);
    return (data.data?.pages ?? []).map((page, index) => ({ index, imageUrl: page.url }));
  }
}
