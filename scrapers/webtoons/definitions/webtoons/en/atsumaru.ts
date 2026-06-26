import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const j = (d: any) => typeof d === 'string' ? JSON.parse(d) : d;

export class AtsumaruScraper extends BaseScraper {
  readonly name = 'Atsumaru';
  readonly baseUrl = 'https://atsu.moe';
  readonly lang = 'en';

  private get18Mode(): string {
    return '&adult=1';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/api/infinite/trending?page=${page - 1}&types=Manga,Manwha,Manhua,OEL${this.get18Mode()}`);
    const data = j(res.data);
    const mangaList = data.items || data.manga || [];
    const mangas: Manga[] = mangaList.map((item: any) => ({
      title: item.title || item.name || "",
      url: item.slug || item.id?.toString() || item.url || "",
      thumbnailUrl: this.absUrl(item.thumbnail || item.cover_url || item.cover || ""),
      lang: this.lang,
    }));
    const hasNextPage = false;
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/api/infinite/recentlyUpdated?page=${page - 1}&types=Manga,Manwha,Manhua,OEL${this.get18Mode()}`);
    const data = j(res.data);
    const mangaList = data.items || data.manga || [];
    const mangas: Manga[] = mangaList.map((item: any) => ({
      title: item.title || item.name || "",
      url: item.slug || item.id?.toString() || item.url || "",
      thumbnailUrl: this.absUrl(item.thumbnail || item.cover_url || item.cover || ""),
      lang: this.lang,
    }));
    const hasNextPage = false;
    return { mangas, hasNextPage };
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
    return (Array.isArray(pages) ? pages : []).map((url: string, index: number) => ({
      index,
      imageUrl: this.absUrl(typeof url === "string" ? url : url.url || url.imageUrl || ""),
    }));
  }
}
