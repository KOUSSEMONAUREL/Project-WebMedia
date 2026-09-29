import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.mangade.io/api';
const PAGE_SIZE = 20;

interface MangaDEPayload<T> {
  data: T;
}

interface MangaDEListPage {
  list: MangaDEComic[];
  totalPage: number;
  page: string;
}

interface MangaDEComic {
  id: string;
  name: string;
  slug?: string | null;
  image: string;
  description?: string | null;
  genre_names?: string | null;
  status?: string | null;
  news_chapters?: MangaDEChapter[];
}

interface MangaDEChapter {
  id: string;
  name: string;
  slug?: string | null;
  chapter_number?: string | null;
  published_date?: string | null;
  chapter_images?: MangaDEPage[];
}

interface MangaDEPage {
  image: string;
}

export class MangaDEScraper extends BaseScraper {
  readonly name = 'MangaDE';
  readonly baseUrl = 'https://mangade.io';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.comics(page, '', 'most-viewed');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.comics(page, '', 'newest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.comics(page, query.trim());
  }

  private async comics(page: number, query: string, sort?: string): Promise<SearchResult> {
    const url = new URL(`${API_URL}/comics`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(PAGE_SIZE));
    if (query) url.searchParams.set('name', query);
    if (sort) url.searchParams.set('sort', sort);
    const response = await this.get(url.toString());
    const data = (response.data as MangaDEPayload<MangaDEListPage>).data;
    const mangas: Manga[] = (data.list ?? []).map((c) => this.comicToManga(c));
    return { mangas, hasNextPage: Number(data.page) < data.totalPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const data = await this.comicView(this.mangaIdOf(mangaUrl));
    const manga = this.comicToManga(data);
    return {
      title: manga.title,
      thumbnailUrl: manga.thumbnailUrl,
      description: manga.description,
      genre: manga.genre,
      status: manga.status,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const data = await this.comicView(this.mangaIdOf(mangaUrl));
    return (data.news_chapters ?? []).map((c) => ({
      url: `/${data.slug}/${c.slug}?cid=${c.id}&mid=${data.id}`,
      name: c.name,
      chapterNumber: c.chapter_number != null && c.chapter_number !== '' ? (Number(c.chapter_number) || -1) : -1,
      dateUpload: this.parseDateTime(c.published_date),
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const cid = new URL(this.absUrl(chapterUrl)).searchParams.get('cid');
    if (!cid) throw new Error('Missing chapter id');
    const response = await this.get(`${API_URL}/chapters/${cid}/view`);
    const data = (response.data as MangaDEPayload<MangaDEChapter>).data;
    return (data.chapter_images ?? []).map((p, index) => ({ imageUrl: p.image, index }));
  }

  private async comicView(id: string): Promise<MangaDEComic> {
    if (!id) throw new Error('Missing manga id');
    const response = await this.get(`${API_URL}/comics/${id}/view`);
    return (response.data as MangaDEPayload<MangaDEComic>).data;
  }

  private comicToManga(c: MangaDEComic): Manga {
    return {
      url: `/${c.slug}?mid=${c.id}`,
      title: c.name,
      thumbnailUrl: c.image,
      lang: this.lang,
      description: c.description ?? undefined,
      genre: c.genre_names?.replace(/,/g, ', ') || undefined,
      status: this.parseStatus(c.status),
    };
  }

  private mangaIdOf(mangaUrl: string): string {
    return new URL(this.absUrl(mangaUrl)).searchParams.get('mid') ?? '';
  }

  private parseStatus(status: string | null | undefined): MangaStatus {
    switch (status) {
      case 'Ongoing':
      case 'Releasing':
        return 1;
      case 'Completed':
        return 0;
      case 'On Hiatus':
        return 3;
      default:
        return undefined;
    }
  }

  private parseDateTime(raw: string | null | undefined): number {
    const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return 0;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
}
