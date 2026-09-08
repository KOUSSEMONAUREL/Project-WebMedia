import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface AllAnimeCard {
  _id: string;
  name: string;
  thumbnail?: string;
  englishName?: string;
}
interface AllAnimePopularResponse {
  data: {
    queryPopular: {
      recommendations: { anyCard: AllAnimeCard }[];
    };
  };
}
interface AllAnimeSearchResponse {
  data: {
    mangas: {
      edges: AllAnimeCard[];
    };
  };
}
interface AllAnimeMangaResponse {
  data: {
    manga: {
      _id: string;
      name: string;
      thumbnail?: string;
      description?: string;
      authors?: string[];
      genres?: string[];
      tags?: string[];
      status?: string;
      englishName?: string;
      availableChaptersDetail: { sub: string[] };
    };
    episodeInfos: {
      episodeIdNum: string;
      notes?: string;
      uploadDates?: string;
    }[];
  };
}

const POPULAR_QUERY = `query ($type: VaildPopularTypeEnumType!,$size: Int!,$page: Int,$dateRange: Int,$allowAdult: Boolean,$allowUnknown: Boolean){queryPopular(type:$type,size:$size,dateRange:$dateRange,page:$page,allowAdult:$allowAdult,allowUnknown:$allowUnknown){recommendations{anyCard{_id name thumbnail englishName}}}}`;
const SEARCH_QUERY = `query ($search: SearchInput,$size: Int,$page: Int,$translationType: VaildTranslationTypeMangaEnumType,$countryOrigin: VaildCountryOriginEnumType){mangas(search:$search,limit:$size,page:$page,translationType:$translationType,countryOrigin:$countryOrigin){edges{_id name thumbnail englishName}}}`;
const UPDATE_QUERY = `query ($id: String!,$showId: String!,$search: SearchInput){manga(_id:$id,search:$search){_id name thumbnail description authors genres tags status englishName availableChaptersDetail} episodeInfos(showId:$showId,episodeNumStart:0,episodeNumEnd:9999){episodeIdNum notes uploadDates}}`;

function cardToManga(card: AllAnimeCard, lang = 'en'): Manga {
  return {
    title: card.name || card.englishName || 'Unknown',
    url: `/manga/${card._id}`,
    thumbnailUrl: card.thumbnail ? `https://cdn.mkissa.net/${card.thumbnail}`.replace('mcovers/', 'https://cdn.mkissa.net/') : card.thumbnail ? `https://cdn.mkissa.net/${card.thumbnail}` : '',
    lang,
  };
}

function toThumbnailUrl(thumb: string | undefined): string {
  if (!thumb) return '';
  if (thumb.startsWith('http')) return thumb;
  // cdn path
  return `https://cdn.mkissa.net/${thumb}`;
}

export class AllanimeScraper extends BaseScraper {
  readonly name = 'AllAnime';
  readonly baseUrl = 'https://mkissa.to';
  readonly lang = 'en';
  private readonly apiUrl = 'https://api.mkissa.net/api';
  private readonly apiDomain = 'api.mkissa.net';

  private async apiPost(query: string, variables: unknown): Promise<unknown> {
    const res = await this.client.post(this.apiUrl, { query, variables }, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/`,
      },
    });
    return res.data;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const variables = {
      type: 'manga',
      size: 25,
      dateRange: 0,
      page,
      allowAdult: true,
      allowUnknown: false,
    };
    const data = await this.apiPost(POPULAR_QUERY, variables) as AllAnimePopularResponse;
    const cards = data?.data?.queryPopular?.recommendations?.map(r => r.anyCard) || [];
    const mangas = cards.map(c => ({
      title: c.name,
      url: `/manga/${c._id}`,
      thumbnailUrl: toThumbnailUrl(c.thumbnail),
      lang: this.lang,
    }));
    const hasNextPage = cards.length === 25;
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const variables: Record<string, unknown> = {
      search: {
        query: query.trim() || undefined,
        sortBy: 'Latest_Update',
        isManga: true,
        allowAdult: true,
        allowUnknown: false,
      },
      size: 25,
      page,
      translationType: 'sub',
      countryOrigin: 'ALL',
    };
    const data = await this.apiPost(SEARCH_QUERY, variables) as AllAnimeSearchResponse;
    const edges = data?.data?.mangas?.edges || [];
    const mangas = edges.map(e => ({
      title: e.name,
      url: `/manga/${e._id}`,
      thumbnailUrl: toThumbnailUrl(e.thumbnail),
      lang: this.lang,
    }));
    const hasNextPage = edges.length === 25;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.split('/').filter(Boolean).pop()?.split('?')[0] || mangaUrl;
    const cleanId = id.includes('/manga/') ? id.split('/manga/')[1].split('/')[0] : id;
    const variables = {
      id: cleanId,
      showId: `manga@${cleanId}`,
      search: { fromSearch: true },
    };
    const data = await this.apiPost(UPDATE_QUERY, variables) as AllAnimeMangaResponse;
    const manga = data?.data?.manga;
    if (!manga) throw new Error('Manga not found');
    return {
      title: manga.name,
      url: `/manga/${manga._id}`,
      thumbnailUrl: toThumbnailUrl(manga.thumbnail),
      lang: this.lang,
      description: manga.description || undefined,
      author: manga.authors?.join(', ') || undefined,
      genre: [...(manga.genres || []), ...(manga.tags || [])].join(', ') || undefined,
      status: manga.status === 'Ongoing' ? 1 : manga.status === 'Completed' ? 0 : 3,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('/').filter(Boolean).pop()?.split('?')[0] || mangaUrl;
    const cleanId = id.includes('/manga/') ? id.split('/manga/')[1].split('/')[0] : id;
    const slug = cleanId;
    const variables = {
      id: cleanId,
      showId: `manga@${cleanId}`,
      search: { fromSearch: true },
    };
    const data = await this.apiPost(UPDATE_QUERY, variables) as AllAnimeMangaResponse;
    const manga = data?.data?.manga;
    const episodeInfos = data?.data?.episodeInfos || [];
    if (!manga) return [];
    const detailChapters = manga.availableChaptersDetail?.sub || [];
    const infoMap = new Map(episodeInfos.map(e => [e.episodeIdNum, e]));
    const chapters: Chapter[] = detailChapters.map(num => {
      const info = infoMap.get(num);
      const name = info?.notes ? `Chapter ${num} - ${info.notes}` : `Chapter ${num}`;
      const dateUpload = info?.uploadDates ? Date.parse(info.uploadDates) || undefined : undefined;
      return {
        name,
        url: `/manga/${slug}/chapter/${num}`,
        chapterNumber: parseFloat(num),
        dateUpload,
      };
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    // AllAnime manga reading requires fetching via site's chapter reader; fallback to placeholder
    // The upstream uses a separate page endpoint; we probe the HTML reader
    // Try to fetch the chapter page HTML and extract images
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('img[src*="cdn.mkissa.net"], img[data-src]').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (!src) return;
      const imageUrl = src.startsWith('http') ? src : this.absUrl(src);
      if (imageUrl.includes('cdn.mkissa') || imageUrl.match(/\.(jpg|png|webp)/)) {
        pages.push({ index: pages.length, imageUrl });
      }
    });
    if (pages.length > 0) return pages;
    // Fallback: try to find __NEXT_DATA__ JSON
    const nextData = $('#__NEXT_DATA__').html();
    if (nextData) {
      try {
        const json = JSON.parse(nextData);
        const images: string[] = JSON.stringify(json).match(/https:\/\/cdn\.mkissa\.net[^"]+\.(jpg|png|webp)/g) || [];
        if (images.length > 0) {
          return images.map((url, index) => ({ index, imageUrl: url }));
        }
      } catch { /* ignore */ }
    }
    throw new Error('No pages found or chapter requires JS rendering');
  }
}
