import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class VizshonenjumpScraper extends BaseScraper {
  readonly name = 'VIZ Shonen Jump';
  readonly baseUrl = 'https://www.viz.com';
  readonly lang = 'en';

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
