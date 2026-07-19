import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const API_DOMAIN = 'api.mkissa.net';
const API_URL = `https://${API_DOMAIN}/api`;
const LIMIT = 20;

function titleToSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z\d]+/g, '-');
}

const SEARCH_QUERY = `query ($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges { _id name thumbnail englishName }
  }
}`;

const POPULAR_QUERY = `query ($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int, $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) {
  queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page, allowAdult: $allowAdult, allowUnknown: $allowUnknown) {
    recommendations {
      anyCard { _id name thumbnail englishName }
    }
  }
}`;

const UPDATE_QUERY = `query ($id: String!, $showId: String!) {
  manga(_id: $id) {
    _id name thumbnail description authors genres tags status altNames englishName malId aniListId relatedMangas availableChaptersDetail
  }
  episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) {
    episodeIdNum notes uploadDates
  }
}`;

const IMAGE_CDN = 'https://wp.youtube-anime.com';

export class AllMangaScraper extends BaseScraper {
  readonly name = 'AllManga';
  readonly baseUrl = 'https://allmanga.to';
  readonly lang = 'en';

  private async graphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.post(API_URL, {
      query: `query ${query}`,
      variables,
    });
    const body = res.data as { data?: T; errors?: unknown[] };
    if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
    return body.data as T;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const data = await this.graphQL<{
      queryPopular: { recommendations: { anyCard: { _id: string; name: string; thumbnail?: string; englishName?: string } | null }[] };
    }>(POPULAR_QUERY, {
      type: 'manga',
      size: LIMIT,
      page,
      dateRange: 0,
      allowAdult: false,
      allowUnknown: false,
    });

    const mangas = data.queryPopular.recommendations
      .map(r => r.anyCard)
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map(card => ({
        title: card.englishName || card.name,
        url: card._id,
        thumbnailUrl: this.parseThumbnail(card.thumbnail),
        lang: this.lang,
      }));

    return { mangas, hasNextPage: mangas.length === LIMIT };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const data = await this.graphQL<{
      mangas: { edges: { _id: string; name: string; thumbnail?: string; englishName?: string }[] };
    }>(SEARCH_QUERY, {
      search: {
        query: query || undefined,
        isManga: true,
        allowAdult: false,
        allowUnknown: false,
      },
      size: LIMIT,
      page,
      translationType: 'sub',
      countryOrigin: 'ALL',
    });

    const mangas = data.mangas.edges.map(edge => ({
      title: edge.englishName || edge.name,
      url: edge._id,
      thumbnailUrl: this.parseThumbnail(edge.thumbnail),
      lang: this.lang,
    }));

    return { mangas, hasNextPage: mangas.length === LIMIT };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const showId = `manga@${mangaUrl}`;
    const data = await this.graphQL<{
      manga: {
        _id: string;
        name: string;
        thumbnail?: string;
        description?: string;
        authors?: string[];
        genres?: string[];
        tags?: string[];
        status?: string;
        altNames?: string[];
        englishName?: string;
        malId?: string;
        aniListId?: string;
        availableChaptersDetail: { sub: string[] };
      };
    }>(UPDATE_QUERY, { id: mangaUrl, showId });

    const m = data.manga;
    const slug = titleToSlug(m.name);
    const url = `${m._id}/${slug}`;

    const statusMap: Record<string, MangaStatus> = {
      releasing: 1,
      ongoing: 1,
      finished: 2,
      completed: 2,
    };
    const statusVal = m.status?.toLowerCase() || '';
    const status: MangaStatus = Object.entries(statusMap).find(([k]) => statusVal.includes(k))?.[1];

    const parts: string[] = [];
    if (m.description) parts.push(m.description.replace(/<[^>]*>/g, '').trim());
    if (m.malId) parts.push(`[MyAnimeList](https://myanimelist.net/manga/${m.malId})`);
    if (m.aniListId) parts.push(`[AniList](https://anilist.co/manga/${m.aniListId})`);
    if (m.altNames?.length) {
      parts.push('Alternative Titles:\n' + m.altNames.map(t => `- ${t}`).join('\n'));
    }

    const genre = [...(m.genres || []), ...(m.tags || [])].join(', ');

    return {
      title: m.englishName || m.name,
      url,
      thumbnailUrl: this.parseThumbnail(m.thumbnail),
      description: parts.length ? parts.join('\n\n') : undefined,
      author: m.authors?.[0] || undefined,
      artist: m.authors?.[0] || undefined,
      genre: genre || undefined,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const mangaId = mangaUrl.split('/')[0];
    const showId = `manga@${mangaId}`;

    const data = await this.graphQL<{
      manga: { availableChaptersDetail: { sub: string[] }; name: string };
      episodeInfos: { episodeIdNum: number; notes?: string | null; uploadDates?: { sub?: string } | null }[];
    }>(UPDATE_QUERY, { id: mangaId, showId });

    const slug = titleToSlug(data.manga.name);
    const chapterMap = new Map<number, typeof data.episodeInfos[0]>();
    for (const ch of data.episodeInfos) {
      chapterMap.set(ch.episodeIdNum, ch);
    }

    return data.manga.availableChaptersDetail.sub.map(chapterNumStr => {
      const chapterNum = Number(chapterNumStr);
      const info = chapterMap.get(chapterNum);
      let name = `Chapter ${chapterNum}`;
      if (info?.notes && !/\d/.test(info.notes)) {
        name += `: ${info.notes}`;
      }
      const timestamp = info?.uploadDates?.sub
        ? new Date(info.uploadDates.sub).getTime()
        : undefined;

      return {
        name,
        url: `${mangaId}/${slug}/${chapterNum}`,
        chapterNumber: chapterNum,
        dateUpload: timestamp,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('/');
    const mangaId = parts[0];
    const chapterNum = parts[2];

    try {
      const data = await this.graphQL<{
        chapterPages: { edges: { pictureUrlHead?: string; pictureUrls: any[] }[] };
      }>(`query($mangaId:String!,$translationType:VaildTranslationTypeMangaEnumType!,$chapterString:String!){chapterPages(mangaId:$mangaId,translationType:$translationType,chapterString:$chapterString){edges{pictureUrlHead pictureUrls}}}`, {
        mangaId,
        translationType: 'sub',
        chapterString: chapterNum,
      });

      if (!data?.chapterPages?.edges?.length) return [];

      const pageNode = data.chapterPages.edges.find(e =>
        !!e.pictureUrlHead || e.pictureUrls?.some((p: any) => typeof p === 'string' || p?.url)
      ) || data.chapterPages.edges[0];

      if (!pageNode) return [];

      const imageDomain = pageNode.pictureUrlHead
        ? (/^https?:\/\//.test(pageNode.pictureUrlHead)
          ? pageNode.pictureUrlHead.replace(/\/+$/, '/')
          : `https://${pageNode.pictureUrlHead.replace(/\/+$/, '/')}`)
        : 'https://ytimgf.youtube-anime.com/';

      const urls = pageNode.pictureUrls || [];
      return urls
        .map((item: any, index: number): Page | null => {
          const url = typeof item === 'string' ? item : item?.url;
          if (!url) return null;
          const imageUrl = /^https?:\/\//.test(url) ? url : imageDomain + url.replace(/^\//, '');
          return { index, imageUrl };
        })
        .filter(Boolean) as Page[];
    } catch {
      return [];
    }
  }

  private parseThumbnail(url?: string | null): string {
    if (!url) return '';
    if (url.match(/^https?:\/\//)) return url;
    return `${IMAGE_CDN}/aln.youtube-anime.com/${url}?w=250`;
  }
}
