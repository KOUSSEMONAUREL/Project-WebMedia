import { MadaraScraper } from '../../../engine/madara';
import type { Chapter, SearchResult } from '../../../engine/types';

interface HariChapterDto {
  chapter_name: string;
  chapter_slug: string;
  updated_at?: string | null;
}

interface HariChapterListResponse {
  data: {
    chapters: HariChapterDto[];
    last_page: number;
  };
}

const CHAPTERS_PER_PAGE = 100;

export class HarimangacoukScraper extends MadaraScraper {
  constructor() {
    super('HariManga.co.uk', 'https://www.harimanga.co.uk', 'en');
  }

  override async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://') || query.startsWith('slug:')) {
      return super.getSearch(query, page);
    }
    const path = page > 1 ? `/home/page/${page}` : '/home';
    const url = `${this.baseUrl}${path}?s=${encodeURIComponent(query)}&post_type=wp-manga`;
    const res = await this.get(url);
    return this.searchMangaParse(res.data);
  }

  private mangaSlug(mangaUrl: string): string {
    const path = new URL(this.absUrl(mangaUrl)).pathname;
    return path.split('/').filter(Boolean)[1] ?? '';
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.mangaSlug(mangaUrl);
    if (!slug) return [];
    const base = `${this.baseUrl}/api/comics/${encodeURIComponent(slug)}/chapters?per_page=${CHAPTERS_PER_PAGE}&order=desc`;
    const firstRes = await this.get(`${base}&page=1`, { headers: { Accept: 'application/json' } });
    const first = firstRes.data as HariChapterListResponse;
    const pages: HariChapterDto[][] = [first.data?.chapters ?? []];
    const lastPage = first.data?.last_page ?? 1;
    for (let page = 2; page <= lastPage; page++) {
      const res = await this.get(`${base}&page=${page}`, { headers: { Accept: 'application/json' } });
      pages.push((res.data as HariChapterListResponse).data?.chapters ?? []);
    }
    return pages.flat().map(dto => {
      const parsed = dto.updated_at ? Date.parse(dto.updated_at) : NaN;
      return {
        name: dto.chapter_name,
        url: `${this.baseUrl}/manga/${slug}/${dto.chapter_slug}`,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    });
  }
}
