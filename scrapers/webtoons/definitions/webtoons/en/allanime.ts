import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface SearchManga {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
}

interface MangaDetails extends SearchManga {
  description?: string | null;
  authors?: string[] | null;
  genres?: string[] | null;
  tags?: string[] | null;
  status?: string | null;
  altNames?: string[] | null;
  availableChaptersDetail?: { sub?: string[] };
}

const POPULAR_QUERY = `query ($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int, $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) {
  queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page, allowAdult: $allowAdult, allowUnknown: $allowUnknown) {
    recommendations { anyCard { _id name thumbnail englishName } }
  }
}`;

const SEARCH_QUERY = `query ($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges { _id name thumbnail englishName }
  }
}`;

const UPDATE_QUERY = `query ($id: String!, $search: SearchInput) {
  manga(_id: $id, search: $search) {
    _id name thumbnail description authors genres tags status altNames englishName availableChaptersDetail
  }
}`;

function parseStatus(status: string | null | undefined): MangaStatus {
  if (!status) return undefined;
  if (status.toLowerCase().includes('releasing')) return 1;
  if (status.toLowerCase().includes('finished')) return 0;
  return undefined;
}

export class AllAnimeScraper extends BaseScraper {
  readonly name = 'AllManga';
  readonly baseUrl = 'https://mkissa.to';
  readonly lang = 'en';

  private readonly apiUrl = 'https://api.mkissa.net/api';
  private readonly limit = 20;

  async getPopular(page = 1): Promise<SearchResult> {
    const data = await this.query<{
      queryPopular?: { recommendations?: Array<{ anyCard?: SearchManga | null }> };
    }>(POPULAR_QUERY, {
      type: 'manga',
      size: this.limit,
      dateRange: 0,
      page,
      allowAdult: false,
      allowUnknown: false,
    });
    const cards = data.queryPopular?.recommendations ?? [];
    const mangas = cards
      .map(card => card.anyCard)
      .filter((manga): manga is SearchManga => manga !== null && manga !== undefined)
      .map(manga => this.toManga(manga));
    return { mangas, hasNextPage: cards.length === this.limit };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const data = await this.query<{ mangas?: { edges?: SearchManga[] } }>(SEARCH_QUERY, {
      search: {
        query: query.trim() || undefined,
        isManga: true,
        allowAdult: false,
        allowUnknown: false,
      },
      size: this.limit,
      page,
      translationType: 'sub',
      countryOrigin: 'ALL',
    });
    const edges = data.mangas?.edges ?? [];
    return { mangas: edges.map(manga => this.toManga(manga)), hasNextPage: edges.length === this.limit };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.mangaId(mangaUrl);
    if (!id) return {};
    const data = await this.query<{ manga?: MangaDetails | null }>(UPDATE_QUERY, {
      id,
      search: { fromSearch: true, allowAdult: true },
    });
    const manga = data.manga;
    if (!manga) return {};
    let description = manga.description ?? '';
    if (manga.altNames && manga.altNames.length > 0) {
      if (description) description += '\n\n';
      description += 'Alternative Titles:\n' + manga.altNames.map(name => `- ${name}`).join('\n');
    }
    return {
      title: manga.englishName ?? manga.name,
      thumbnailUrl: this.thumbnail(manga.thumbnail),
      description: description || undefined,
      author: manga.authors?.[0]?.trim() || undefined,
      artist: manga.authors?.[0]?.trim() || undefined,
      genre: [...(manga.genres ?? []), ...(manga.tags ?? [])].join(', ') || undefined,
      status: parseStatus(manga.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.mangaId(mangaUrl);
    if (!id) return [];
    const data = await this.query<{ manga?: MangaDetails | null }>(UPDATE_QUERY, {
      id,
      search: { fromSearch: true, allowAdult: true },
    });
    const numbers = data.manga?.availableChaptersDetail?.sub ?? [];
    return numbers.map(value => {
      const number = Number(value);
      return {
        name: `Chapter ${value}`,
        url: `${this.baseUrl}/manga/${id}/chapter-${value}-sub`,
        chapterNumber: Number.isFinite(number) ? number : undefined,
      };
    });
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    throw new Error('AllManga: getPageList() not implemented (page images require a WebView)');
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.post(
      this.apiUrl,
      { query, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Referer: `${this.baseUrl}/`,
        },
      },
    );
    const body = res.data as { data?: T; errors?: Array<{ message?: string }> };
    if (!body.data) {
      throw new Error(body.errors?.[0]?.message ?? 'AllManga: empty GraphQL response');
    }
    return body.data;
  }

  private toManga(manga: SearchManga): Manga {
    return {
      title: manga.englishName ?? manga.name,
      url: `${this.baseUrl}/manga/${manga._id}`,
      thumbnailUrl: this.thumbnail(manga.thumbnail) ?? '',
      lang: this.lang,
    };
  }

  private thumbnail(thumbnail: string | null | undefined): string | undefined {
    if (!thumbnail) return undefined;
    if (/^https?:\/\//.test(thumbnail)) return thumbnail;
    return `https://wp.youtube-anime.com/aln.youtube-anime.com/${thumbnail}?w=250`;
  }

  private mangaId(url: string): string | undefined {
    try {
      const parts = new URL(url, this.baseUrl).pathname.split('/').filter(Boolean);
      return parts[1] ?? parts[0];
    } catch {
      return url || undefined;
    }
  }
}
