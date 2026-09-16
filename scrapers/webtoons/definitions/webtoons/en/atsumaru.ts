import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const j = (d: unknown) => typeof d === 'string' ? JSON.parse(d as string) as unknown : d;
const BROWSE_LIMIT = 40;
const PROTOCOL_REGEX = /^https?:?\/\//;

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
    const raw = j(res.data) as Record<string, unknown>;
    return {
      title: (raw['name'] as string) || (raw['title'] as string) || (raw['postTitle'] as string) || "",
      url: mangaUrl,
      thumbnailUrl: this.absUrl((raw['cover'] as string) || (raw['cover_url'] as string) || (raw['thumbnail_url'] as string) || (raw['featuredImage'] as string) || ""),
      description: (((raw['summary'] as string) || (raw['description'] as string) || (raw['postContent'] as string) || "").replace(/<[^>]*>/g, "").trim() || undefined),
      author: raw['author'] as string | undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const raw = j(res.data) as Record<string, unknown>;
    const chapters = (raw['chapters'] as unknown[]) ?? (raw['data'] as unknown[]) ?? [];
    return (Array.isArray(chapters) ? chapters : []).map((ch: unknown) => {
      const c = ch as Record<string, unknown>;
      return {
        name: (c['name'] as string) || (c['title'] as string) || `Chapter ${c['chapter_number'] ?? c['number'] ?? ""}`,
        url: (c['url'] as string) || (c['id']?.toString() ?? "") || (c['slug'] as string) || "",
        chapterNumber: (c['chapter_number'] as number | undefined) ?? (c['number'] as number | undefined),
        dateUpload: (c['created_at'] as string) || (c['published'] as string) || (c['date_upload'] as string) ? new Date((c['created_at'] as string) || (c['published'] as string) || (c['date_upload'] as string)).getTime() : undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const data = j(res.data) as Record<string, unknown>;
    const pages = (data?.pages as unknown[]) ?? (data?.data as unknown[]) ?? [];
    return (Array.isArray(pages) ? pages : []).map((item: unknown, index: number) => {
      const raw = typeof item === "string" ? item : ((item as Record<string, unknown>)?.url as string) ?? ((item as Record<string, unknown>)?.imageUrl as string) ?? ((item as Record<string, unknown>)?.image as string) ?? "";
      let imageUrl = this.absUrl(raw);
      if (raw) {
        if (raw.startsWith("//")) {
          imageUrl = `https:${raw}`;
        } else if (raw.startsWith("/")) {
          imageUrl = `${this.baseUrl}/static/${raw.replace(/^\/+/, '').replace(/^static\//, '')}`;
        }
        imageUrl = imageUrl.replace(PROTOCOL_REGEX, "https://cdn.");
      }
      return { index, imageUrl };
    });
  }
}
