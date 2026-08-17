import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const j = (d: any) => typeof d === 'string' ? JSON.parse(d) : d;
const BROWSE_LIMIT = 40;

export class AtsumaruScraper extends BaseScraper {
  readonly name = 'Atsumaru';
  readonly baseUrl = 'https://atsu.moe';
  readonly lang = 'en';

  private get18Mode(): string {
    return '&adult=1';
  }

  private browseImageUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    if (path.startsWith('//')) return `https:${path}`;
    return `${this.baseUrl}/static/${path.replace(/^\/+/, '').replace(/^static\//, '')}`;
  }

  private mapBrowseItems(data: any): Manga[] {
    const mangaList = data.items || data.manga || [];
    return mangaList.map((item: any) => ({
      title: item.title || item.name || "",
      url: item.slug || item.id?.toString() || item.url || "",
      thumbnailUrl: this.browseImageUrl(item.image || item.poster || item.thumbnail || item.cover_url || item.cover || ""),
      lang: this.lang,
    }));
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * BROWSE_LIMIT;
    const res = await this.get(`${this.baseUrl}/api/home2/popular?offset=${offset}&limit=${BROWSE_LIMIT}&types=Manga,Manwha,Manhua,OEL&mediums=Comic&timeframe=daily${this.get18Mode()}`);
    const data = j(res.data);
    return { mangas: this.mapBrowseItems(data), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * BROWSE_LIMIT;
    const res = await this.get(`${this.baseUrl}/api/home2/recentlyUpdated?offset=${offset}&limit=${BROWSE_LIMIT}&types=Manga,Manwha,Manhua,OEL&mediums=Comic${this.get18Mode()}`);
    const data = j(res.data);
    return { mangas: this.mapBrowseItems(data), hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const data = j(res.data);
    return {
      title: data?.name || data?.title || data?.postTitle || "",
      url: mangaUrl,
      thumbnailUrl: this.absUrl(data?.cover || data?.cover_url || data?.thumbnail_url || data?.featuredImage || ""),
      description: (data?.summary || data?.description || data?.postContent || "").replace(/<[^>]*>/g, "").trim() || undefined,
      author: data?.author || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const data = j(res.data);
    const chapters = data?.chapters || data?.data || [];
    return (Array.isArray(chapters) ? chapters : []).map((ch: any) => ({
      name: ch.name || ch.title || `Chapter ${ch.chapter_number || ch.number || ""}`,
      url: ch.url || ch.id?.toString() || ch.slug || "",
      chapterNumber: ch.chapter_number || ch.number || undefined,
      dateUpload: ch.created_at || ch.published || ch.date_upload ? new Date(ch.created_at || ch.published || ch.date_upload).getTime() : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const data = j(res.data);
    const pages = data?.pages || data?.data || [];
    return (Array.isArray(pages) ? pages : []).map((item: any, index: number) => ({
      index,
      imageUrl: this.absUrl(typeof item === "string" ? item : item.url || item.imageUrl || ""),
    }));
  }
}
