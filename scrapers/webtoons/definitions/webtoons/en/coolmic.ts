import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class CoolmicScraper extends BaseScraper {
  readonly name = 'Coolmic';
  readonly baseUrl = 'https://coolmic.me';
  readonly lang = 'en';

  private apiUrl = `${this.baseUrl.replace(/\/$/, '')}/api/v1`;
  private cdnUrl = 'https://en-img.coolmic.me';

  private buildUrl(endpoint: string, params: Record<string, string>): string {
    const u = new URL(`${this.apiUrl}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  }

  private async request(endpoint: string, params: Record<string, string>): Promise<any> {
    const url = this.buildUrl(endpoint, params);
    const res = await this.get(url, { headers: { Cookie: 'is_mature=true' } });
    return res.data;
  }

  private toManga(item: any): Manga | null {
    const titleId = String(item?.title_id ?? '');
    const title = String(item?.title_name ?? '');
    if (!titleId || !title) return null;
    const id = titleId.padStart(9, '0');
    const thumbnailUrl = `${this.cdnUrl}/titles/${id.slice(0, 3)}/${id.slice(0, 6)}/${id}/${id}_large_vertical.jpg`;
    return { title, url: this.absUrl(`/titles/${titleId}`), thumbnailUrl, lang: this.lang };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const data = await this.request('/search_titles', { keyword: '', page: String(_page), per: '20', search_field: 'all', sort: '3' });
    const items: any[] = Array.isArray(data?.results) ? data.results : [];
    const mangas = items.map(i => this.toManga(i)).filter((m): m is Manga => m !== null);
    const total = Number(data?.total ?? 0);
    return { mangas, hasNextPage: _page * 20 < total };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const data = await this.request('/search_titles', { keyword: '', page: String(_page), per: '20', search_field: 'all', sort: '1' });
    const items: any[] = Array.isArray(data?.results) ? data.results : [];
    const mangas = items.map(i => this.toManga(i)).filter((m): m is Manga => m !== null);
    const total = Number(data?.total ?? 0);
    return { mangas, hasNextPage: _page * 20 < total };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const data = await this.request('/search_titles', { keyword: query, page: String(_page), per: '20', search_field: 'all', sort: '1' });
    const items: any[] = Array.isArray(data?.results) ? data.results : [];
    const mangas = items.map(i => this.toManga(i)).filter((m): m is Manga => m !== null);
    const total = Number(data?.total ?? 0);
    return { mangas, hasNextPage: _page * 20 < total };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return { url: mangaUrl, lang: this.lang };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    return [];
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    return [];
  }
}
