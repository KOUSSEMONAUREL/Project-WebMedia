import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.mangacloud.org';
const CDN_URL = 'https://pika.mangacloud.org';

interface ComicListData {
  id: string;
  slug: string;
  name: string;
  cover: string;
  type: string;
  status: string;
}

interface ComicDetailData extends ComicListData {
  summary: string;
  author: string;
  genres: string[];
  tags: string[];
  chapters: ChapterData[];
}

interface ChapterData {
  id: string;
  number: number;
  name: string | null;
  date: number;
}

interface PageData {
  id: string;
  format: string;
}

interface ListResponse {
  data: ComicListData[];
}

interface DetailResponse {
  data: ComicDetailData;
}

interface ChapterResponse {
  data: {
    id: string;
    comicId: string;
    images: PageData[];
  };
}

interface SearchBody {
  title: string | null;
  type: string[];
  sort: string;
  status: string[];
  includes: string[];
  excludes: string[];
  page: number;
}

function toComicManga(c: ComicListData): Manga {
  return {
    title: c.name,
    url: `${API_URL}/comic/${c.slug}`,
    thumbnailUrl: `${CDN_URL}/${c.cover}`,
    lang: 'en',
  };
}

export class MangaCloudScraper extends BaseScraper {
  readonly name = 'MangaCloud';
  readonly baseUrl = 'https://mangacloud.org';
  readonly lang = 'en';

  private async apiPost<T>(path: string, body: SearchBody): Promise<T> {
    const res = await this.post(`${API_URL}${path}`, JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
        Origin: this.baseUrl,
      },
    });
    return JSON.parse(res.data) as T;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const time = page === 1 ? 'today' : page === 2 ? 'week' : 'month';
    const res = await this.get(`${API_URL}/comic-popular-view/${time}`, {
      headers: { Origin: this.baseUrl },
    });
    const data = JSON.parse(res.data) as ListResponse;
    return {
      mangas: (data.data ?? []).map(toComicManga),
      hasNextPage: true,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const body: SearchBody = {
      title: null,
      type: [],
      sort: 'latest',
      status: [],
      includes: [],
      excludes: [],
      page,
    };
    const data = await this.apiPost<ListResponse>('/comic/library', body);
    return {
      mangas: (data.data ?? []).map(toComicManga),
      hasNextPage: (data.data ?? []).length === 10,
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.length < 3 && query.length > 0) {
      throw new Error('Search query must be more than 3 characters!');
    }
    const body: SearchBody = {
      title: query.trim() || null,
      type: [],
      sort: 'latest',
      status: [],
      includes: [],
      excludes: [],
      page,
    };
    const data = await this.apiPost<ListResponse>('/comic/library', body);
    return {
      mangas: (data.data ?? []).map(toComicManga),
      hasNextPage: (data.data ?? []).length === 10,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').pop() ?? '';
    const res = await this.get(`${API_URL}/comic/${slug}`, {
      headers: { Origin: this.baseUrl },
    });
    const data = JSON.parse(res.data) as DetailResponse;
    const comic = data.data;
    return {
      title: comic.name,
      url: `${API_URL}/comic/${slug}`,
      thumbnailUrl: `${CDN_URL}/${comic.cover}`,
      author: comic.author || undefined,
      description: (comic.summary || '').replace(/<[^>]*>/g, '').trim() || undefined,
      genre: [...(comic.genres ?? []), ...(comic.tags ?? [])].join(', ') || undefined,
      lang: 'en',
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').pop() ?? '';
    const res = await this.get(`${API_URL}/comic/${slug}`, {
      headers: { Origin: this.baseUrl },
    });
    const data = JSON.parse(res.data) as DetailResponse;
    const comic = data.data;
    return (comic.chapters ?? []).map(ch => ({
      name: `Chapter ${ch.number.toString().replace(/\.0$/, '')}${ch.name ? ` - ${ch.name}` : ''}`,
      url: `${comic.id}/${ch.id}`,
      chapterNumber: ch.number,
      dateUpload: ch.date,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('/').pop() ?? chapterUrl;
    const res = await this.get(`${API_URL}/chapters/${chapterId}`, {
      headers: { Origin: this.baseUrl },
    });
    const data = JSON.parse(res.data) as ChapterResponse;
    const chapter = data.data;
    return chapter.images.map((img, idx) => ({
      index: idx,
      imageUrl: `${CDN_URL}/${chapter.comicId}/${chapter.id}/${img.id}.${img.format}`,
    }));
  }
}
