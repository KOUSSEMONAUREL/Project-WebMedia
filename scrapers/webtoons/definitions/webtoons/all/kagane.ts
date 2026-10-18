import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface KaganeBook {
  series_id: string;
  title: string;
  cover_image_id?: string | null;
}

interface KaganeSearchResponse {
  content: KaganeBook[];
  last?: boolean;
  total_pages?: number;
}

export class KaganeScraper extends BaseScraper {
  readonly name = 'Kagane';
  readonly baseUrl = 'https://kagane.si';
  readonly lang = 'all';

  private apiUrl = 'https://kagane.si/api/v2';

  async getPopular(_page = 1): Promise<SearchResult> {
    const page = _page - 1;
    const body = { source_type: ['Official', 'Unofficial', 'Mixed'], content_lang: [this.lang === 'all' ? 'en' : this.lang] };
    const url = `${this.apiUrl}/search/series?page=${page}&size=35&sort=total_views,desc`;
    const res = await this.post(url, body);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as KaganeSearchResponse;
    const mangas: Manga[] = (data.content || []).map((b) => ({
      title: b.title,
      url: `/series/${b.series_id}`,
      thumbnailUrl: b.cover_image_id ? `${this.apiUrl}/image/${b.cover_image_id}` : '',
      lang: this.lang,
    }));
    const hasNextPage = data.last === false || (typeof data.total_pages === 'number' && page + 1 < data.total_pages);
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const p = page - 1;
    const body: Record<string, unknown> = {
      source_type: ['Official', 'Unofficial', 'Mixed'],
      content_lang: [this.lang === 'all' ? 'en' : this.lang],
    };
    if (query.trim()) body.title = query.trim();
    const url = `${this.apiUrl}/search/series?page=${p}&size=35&sort=total_views,desc`;
    const res = await this.post(url, body);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as KaganeSearchResponse;
    const mangas: Manga[] = (data.content || []).map((b) => ({
      title: b.title,
      url: `/series/${b.series_id}`,
      thumbnailUrl: b.cover_image_id ? `${this.apiUrl}/image/${b.cover_image_id}` : '',
      lang: this.lang,
    }));
    const hasNextPage = data.last === false;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.split('/').filter(Boolean).pop() || '';
    if (!id) return { url: mangaUrl, lang: this.lang };
    try {
      const res = await this.get(`${this.apiUrl}/series/${id}`);
      const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      return { url: mangaUrl, title: data?.title, thumbnailUrl: data?.cover_image_id ? `${this.apiUrl}/image/${data.cover_image_id}` : undefined, lang: this.lang };
    } catch {
      return { url: mangaUrl, lang: this.lang };
    }
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    return [];
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    return [];
  }
}
