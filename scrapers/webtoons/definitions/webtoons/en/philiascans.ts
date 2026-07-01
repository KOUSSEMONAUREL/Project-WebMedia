import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class SortFilterScraper extends BaseScraper {
  readonly name = 'Philia Scans';
  readonly baseUrl = 'https://$domain';
  readonly lang = 'en';
  private readonly apiUrl = `${this.baseUrl}`;

  async getPopular(page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const data = JSON.parse(res.data);
    const detail = data?.manga || data;
    return {
      title: detail?.name || detail?.title || detail?.postTitle || "",
      url: mangaUrl,
      thumbnailUrl: this.absUrl(detail?.cover || detail?.cover_url || detail?.thumbnail_url || detail?.featuredImage || ""),
      description: (detail?.summary || detail?.description || detail?.postContent || "").replace(/<[^>]*>/g, "").trim() || undefined,
      author: detail?.author || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const data = JSON.parse(res.data);
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
    const data = JSON.parse(res.data);
    const pages = data?.pages || data?.data || [];
    return (Array.isArray(pages) ? pages : []).map((item: any, index: number) => ({
      index,
      imageUrl: this.absUrl(typeof item === "string" ? item : item.url || item.imageUrl || ""),
    }));
  }
}
