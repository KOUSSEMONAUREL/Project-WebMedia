import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api-srv.lemoon.io/api';
const CDN_URL = 'https://cdn.lemoon.io';
const PAGE_SIZE = 30;
const NEW_RELEASES_COLLECTION = '1685422489-new-releases';

const API_HEADERS = {
  Accept: 'application/json',
  'app-name-code': 'lemoon-web',
  'app-version': '2.0.0',
};

interface ImageDto {
  category: string;
  name: string;
}

interface PageDto<T> {
  items: T[];
  page_number: number;
  page_last_number: number;
}

interface ComicDto {
  public_id: string;
  slug: string;
  title: string;
  format: string;
  cover_image?: ImageDto | null;
}

interface ComicDetailsDto {
  public_id: string;
  title: string;
  description?: string | null;
  status: string;
  locale: string;
  cover_image?: ImageDto | null;
  comic: {
    categories: string[];
    created_by?: {
      profile?: {
        display_name?: string | null;
      } | null;
    } | null;
  };
}

interface EpisodeDto {
  public_id: string;
  comic_translation: string;
  title: string;
  position: number;
  published_at?: string | null;
  is_locked: boolean;
  is_member_locked: boolean;
  is_mature: boolean;
}

interface ContentDto {
  media: ImageDto;
}

function coverUrl(image: ImageDto | null | undefined): string {
  return image ? `${CDN_URL}/${image.category}/${image.name}` : '';
}

function parseStatus(status: string): MangaStatus {
  switch (status) {
    case 'published': return 1;
    case 'completed': return 0;
    case 'paused': return 3;
    case 'canceled': return 2;
    default: return undefined;
  }
}

export class LemoonScraper extends BaseScraper {
  readonly name = 'Lemoon';
  readonly baseUrl = 'https://lemoon.io';
  readonly lang = 'all';

  private toManga(item: ComicDto): Manga {
    return {
      title: item.title,
      url: `${this.baseUrl}/series/${item.slug}`,
      thumbnailUrl: coverUrl(item.cover_image),
      lang: this.lang,
    };
  }

  private async apiGet<T>(path: string): Promise<T> {
    const res = await this.get(`${API_URL}${path}`, { headers: API_HEADERS });
    return res.data as T;
  }

  private async getComicPage(page: number, query?: string): Promise<PageDto<ComicDto>> {
    const params = new URLSearchParams({
      format: 'webtoon',
      pageNumber: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (query) params.set('keywords', query);
    return this.apiGet<PageDto<ComicDto>>(`/comic?${params.toString()}`);
  }

  private comicId(mangaUrl: string): string {
    const segment = mangaUrl.split('/series/')[1]?.split(/[/#?]/)[0] ?? '';
    return segment.split('-')[0];
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const data = await this.getComicPage(page);
    return {
      mangas: data.items.map(item => this.toManga(item)),
      hasNextPage: data.page_number < data.page_last_number,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const res = await this.get(`${this.baseUrl}/collections/${NEW_RELEASES_COLLECTION}`);
    const $ = this.$(res.data);
    const seen = new Set<string>();
    const mangas: Manga[] = [];
    $("section[aria-labelledby=collection-heading] a[href*='/series/']").each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      const title = $(el).find('h2').first().text().trim();
      if (!title) return;
      const img = $(el).find('img').first();
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    const data = await this.getComicPage(page, term);
    return {
      mangas: data.items.map(item => this.toManga(item)),
      hasNextPage: data.page_number < data.page_last_number,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.comicId(mangaUrl);
    if (!id) return { url: mangaUrl, lang: this.lang };
    const data = await this.apiGet<ComicDetailsDto>(`/comic/${id}`);
    return {
      title: data.title,
      url: mangaUrl,
      thumbnailUrl: coverUrl(data.cover_image),
      author: data.comic.created_by?.profile?.display_name || undefined,
      description: data.description?.trim() || undefined,
      genre: data.comic.categories.join(', ') || undefined,
      status: parseStatus(data.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.comicId(mangaUrl);
    if (!id) return [];
    const chapters: Chapter[] = [];
    let page = 0;
    let lastPage = 0;
    do {
      page += 1;
      const params = new URLSearchParams({
        comicTranslation: id,
        order: 'position-desc',
        pageSize: '100',
        pageNumber: String(page),
      });
      const data = await this.apiGet<PageDto<EpisodeDto>>(`/episode?${params.toString()}`);
      lastPage = data.page_last_number;
      for (const episode of data.items) {
        const locked = episode.is_locked || episode.is_member_locked;
        chapters.push({
          name: locked ? `🔒 ${episode.title}` : episode.title,
          url: `${this.baseUrl}/series/${id}/${episode.public_id}`,
          chapterNumber: episode.position,
          dateUpload: episode.published_at ? Date.parse(episode.published_at) || undefined : undefined,
        });
      }
      if (data.items.length === 0) break;
    } while (page < lastPage);
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const episodeId = chapterUrl.split('/').filter(Boolean).pop()?.split(/[?#]/)[0] ?? '';
    if (!episodeId) return [];
    const pages: Page[] = [];
    let page = 0;
    let lastPage = 0;
    do {
      page += 1;
      const params = new URLSearchParams({
        order: 'position-asc',
        pageSize: '60',
        pageNumber: String(page),
      });
      const data = await this.apiGet<PageDto<ContentDto>>(`/episode/${episodeId}/content?${params.toString()}`);
      lastPage = data.page_last_number;
      for (const content of data.items) {
        pages.push({ index: pages.length, imageUrl: coverUrl(content.media) });
      }
      if (data.items.length === 0) break;
    } while (page < lastPage);
    return pages;
  }
}

export default LemoonScraper;
