import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface DLManga {
  optimus_id: number;
  title: string;
  description: string;
  thumb: string;
  tags: { id: number; name: string }[];
  creator_name: string;
}

interface DLChapter {
  optimus_id: number;
  manga_optimus_id: number;
  chapter_name: string;
  chapter_order: number;
  published_at: string;
}

interface DLPage {
  href: string;
  type: string;
}

interface DLManifest {
  metadata: { identifier: string };
  readingOrder: DLPage[];
}

export class DoujinioScraper extends BaseScraper {
  readonly name = 'Doujin.io - J18';
  readonly baseUrl = 'https://doujin.io';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get('/api/mangas/popular');
    const mangas: DLManga[] = (res.data as any).data || [];
    return {
      mangas: mangas.map(m => this._mangaToTS(m)),
      hasNextPage: false,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.post('/api/mangas/newest', { limit: 20, offset: (page - 1) * 20 }, {
      headers: { 'Content-Type': 'application/json' },
    });
    const mangas: DLManga[] = (res.data as any).data || [];
    return {
      mangas: mangas.map(m => this._mangaToTS(m)),
      hasNextPage: mangas.length >= 20,
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.post('/api/mangas/search', { keyword: query, page, tags: [] }, {
      headers: { 'Content-Type': 'application/json' },
    });
    const searchResult = (res.data as any).data as any;
    const mangas: DLManga[] = searchResult?.data || [];
    const total: number = searchResult?.total || 0;
    const to: number = searchResult?.to || 0;
    return {
      mangas: mangas.map(m => this._mangaToTS(m)),
      hasNextPage: to < total,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.split('/').pop();
    const res = await this.get(`/api/mangas/${id}`);
    const body = res.data as any;
    const manga: DLManga = body.data || body;
    return {
      title: manga.title,
      url: mangaUrl,
      thumbnailUrl: manga.thumb,
      description: manga.description?.replace(/<[^>]*>/g, '').trim() || undefined,
      author: manga.creator_name || undefined,
      genre: (manga.tags || []).map((t: any) => t.name).join(', '),
      status: 2 as MangaStatus,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('/').pop();
    const res = await this.get(`/api/chapters`, { params: { manga_id: id } });
    const body = res.data as any;
    const chapters: DLChapter[] = body.data || [];
    return chapters.map(ch => ({
      name: ch.chapter_name,
      url: this.absUrl(`/api/mangas/${ch.manga_optimus_id}/${ch.optimus_id}/manifest`),
      chapterNumber: ch.chapter_order + 1,
      dateUpload: ch.published_at ? new Date(ch.published_at).getTime() : undefined,
    })).reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const body = res.data as any;
    const manifest: DLManifest = body.data || body;
    const pages = (manifest.readingOrder || []).filter((p: DLPage) => p.type?.startsWith('image'));
    return pages.map((p: DLPage, i: number) => ({
      index: i,
      imageUrl: p.href,
    }));
  }

  private _mangaToTS(m: DLManga): Manga {
    return {
      title: m.title,
      url: this.absUrl(`/manga/${m.optimus_id}`),
      thumbnailUrl: m.thumb,
      author: m.creator_name || undefined,
      genre: (m.tags || []).map(t => t.name).join(', '),
      lang: this.lang,
    };
  }
}
