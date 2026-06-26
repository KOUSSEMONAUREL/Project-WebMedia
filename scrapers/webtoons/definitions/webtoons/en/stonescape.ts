import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const j = (d: any) => typeof d === 'string' ? JSON.parse(d) : d;

export class StoneScapeScraper extends BaseScraper {
  readonly name = 'StoneScape';
  readonly baseUrl = 'https://stonescape.xyz';
  readonly lang = 'en';
  private readonly apiUrl = `${this.baseUrl}/api`;

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/series/popular?page=${page}&period=week&contentType=manhwa&limit=24`);
    const data = j(res.data);
    const mangaList = data.data || [];
    const mangas: Manga[] = mangaList.map((item: any) => ({
      title: item.title || "",
      url: `/series/${item.slug}`,
      thumbnailUrl: this.absUrl(item.coverUrl || item.cover_url || ""),
      lang: this.lang,
    }));
    const hasNextPage = false;
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/series?page=${page}&limit=24&contentType=manhwa`);
    const data = j(res.data);
    const mangaList = data.data || [];
    const sorted = [...mangaList].sort((a: any, b: any) => {
      const dateA = a.updatedAt || a.updated_at || "";
      const dateB = b.updatedAt || b.updated_at || "";
      return dateB.localeCompare(dateA);
    });
    const mangas: Manga[] = sorted.map((item: any) => ({
      title: item.title || "",
      url: `/series/${item.slug}`,
      thumbnailUrl: this.absUrl(item.coverUrl || item.cover_url || ""),
      lang: this.lang,
    }));
    const hasNextPage = false;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() || '';
    const res = await this.get(`${this.apiUrl}/series/by-slug/${slug}`);
    const data = j(res.data);
    return {
      title: data?.title || data?.name || "",
      url: mangaUrl,
      thumbnailUrl: this.absUrl(data?.coverUrl || data?.cover || data?.thumbnail_url || ""),
      description: (data?.description || data?.summary || "").replace(/<[^>]*>/g, "").trim() || undefined,
      author: data?.author || data?.artist || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() || '';
    const res = await this.get(`${this.apiUrl}/series/by-slug/${slug}/chapters`);
    const data = j(res.data);
    const chapters = data?.chapters || [];
    return (Array.isArray(chapters) ? chapters : []).map((ch: any) => ({
      name: ch.title || `Chapter ${ch.chapterNumber || ""}`,
      url: `#${ch.chapterId}`,
      chapterNumber: ch.chapterNumber ? parseFloat(ch.chapterNumber) : undefined,
      dateUpload: ch.createdAt ? new Date(ch.createdAt).getTime() : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.substring(1);
    const res = await this.get(`${this.apiUrl}/chapters/${chapterId}/pages`);
    const data = j(res.data);
    const pages = data?.allPages || data?.pages || data?.data || [];
    return (Array.isArray(pages) ? pages : []).map((page: any, index: number) => ({
      index: page.pageNumber ? page.pageNumber - 1 : index,
      imageUrl: this.absUrl(page.url || page.imageUrl || ""),
    }));
  }
}
