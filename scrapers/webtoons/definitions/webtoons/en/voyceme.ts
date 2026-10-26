import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const GRAPHQL_URL = 'https://hasura.voyce.me/v1/graphql';
const STATIC_URL = 'https://dlkfxmdtxtzpb.cloudfront.net/';
const PER_PAGE = 20;

interface VoyceSeries {
  id: number;
  slug: string;
  thumbnail: string;
  title: string;
  description?: string | null;
  status?: string | null;
  author?: { username?: string | null } | null;
  genres?: Array<{ genre?: { title?: string | null } | null }>;
  chapters?: VoyceChapter[];
}

interface VoyceChapter {
  id: number;
  title: string;
  created_at: string;
}

function parseStatus(value: string | null | undefined): MangaStatus {
  switch (value) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    default: return undefined;
  }
}

function text(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = value
    .replace(/&#x3C;/gi, '<')
    .replace(/&#x3E;/gi, '>')
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&');
  return decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
}

export class VoycemeScraper extends BaseScraper {
  readonly name = 'Voyce.Me';
  readonly baseUrl = 'https://www.voyce.me';
  readonly lang = 'en';

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.post(GRAPHQL_URL, { query, variables }, {
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/`,
      },
    });
    return res.data.data as T;
  }

  private toManga(item: VoyceSeries): Manga {
    return {
      title: item.title,
      url: `/series/${item.slug}`,
      thumbnailUrl: item.thumbnail ? STATIC_URL + item.thumbnail : '',
      lang: this.lang,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const data = await this.graphql<{ voyce_series: VoyceSeries[] }>(`
      query($limit: Int, $offset: Int) {
        voyce_series(
          where: { publish: { _eq: 1 }, type: { id: { _in: [2, 4] } } },
          order_by: [{ views_counts: { count: desc_nulls_last } }],
          limit: $limit,
          offset: $offset
        ) { id slug thumbnail title }
      }`, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
    const mangas = data.voyce_series.map(item => this.toManga(item));
    return { mangas, hasNextPage: mangas.length === PER_PAGE };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const data = await this.graphql<{ voyce_series: VoyceSeries[] }>(`
      query($limit: Int, $offset: Int) {
        voyce_series(
          where: { publish: { _eq: 1 }, type: { id: { _in: [2, 4] } } },
          order_by: [{ updated_at: desc }],
          limit: $limit,
          offset: $offset
        ) { id slug thumbnail title }
      }`, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
    const mangas = data.voyce_series.map(item => this.toManga(item));
    return { mangas, hasNextPage: mangas.length === PER_PAGE };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const data = await this.graphql<{ voyce_series: VoyceSeries[] }>(`
      query($searchTerm: String!, $limit: Int, $offset: Int) {
        voyce_series(
          where: {
            publish: { _eq: 1 },
            type: { id: { _in: [2, 4] } },
            title: { _ilike: $searchTerm }
          },
          order_by: [{ views_counts: { count: desc_nulls_last } }],
          limit: $limit,
          offset: $offset
        ) { id slug thumbnail title }
      }`, {
      searchTerm: `%${query.trim()}%`,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    });
    const mangas = data.voyce_series.map(item => this.toManga(item));
    return { mangas, hasNextPage: mangas.length === PER_PAGE };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/series/')[1]?.split(/[/#?]/)[0] ?? '';
    const data = await this.graphql<{ voyce_series: VoyceSeries[] }>(`
      query($slug: String!) {
        voyce_series(
          where: {
            publish: { _eq: 1 },
            type: { id: { _in: [2, 4] } },
            slug: { _eq: $slug }
          },
          limit: 1
        ) {
          id slug thumbnail title description status
          author { username }
          genres(order_by: [{ genre: { title: asc } }]) { genre { title } }
        }
      }`, { slug });
    const item = data.voyce_series[0];
    if (!item) return { url: mangaUrl, lang: this.lang };
    return {
      title: item.title,
      url: `/series/${item.slug}`,
      thumbnailUrl: item.thumbnail ? STATIC_URL + item.thumbnail : '',
      author: item.author?.username ?? undefined,
      description: text(item.description),
      genre: item.genres?.map(g => g.genre?.title).filter((g): g is string => Boolean(g)).join(', ') || undefined,
      status: parseStatus(item.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/series/')[1]?.split(/[/#?]/)[0] ?? '';
    const data = await this.graphql<{ voyce_series: VoyceSeries[] }>(`
      query($slug: String!) {
        voyce_series(
          where: {
            publish: { _eq: 1 },
            type: { id: { _in: [2, 4] } },
            slug: { _eq: $slug }
          },
          limit: 1
        ) {
          chapters(order_by: [{ created_at: desc }]) { id title created_at }
        }
      }`, { slug });
    return (data.voyce_series[0]?.chapters ?? []).map(chapter => ({
      name: chapter.title,
      url: `/series/${slug}/${chapter.id}#comic`,
      dateUpload: Date.parse(chapter.created_at) || undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = Number(chapterUrl.split('/').pop()?.split('#')[0]);
    if (!Number.isFinite(chapterId)) return [];
    const data = await this.graphql<{ voyce_chapter_images: Array<{ image: string }> }>(`
      query($chapterId: Int!) {
        voyce_chapter_images(
          where: { chapter_id: { _eq: $chapterId } },
          order_by: { sort_order: asc }
        ) { image }
      }`, { chapterId });
    return data.voyce_chapter_images.map((item, index) => ({
      index,
      imageUrl: STATIC_URL + item.image,
    }));
  }
}

export default VoycemeScraper;
