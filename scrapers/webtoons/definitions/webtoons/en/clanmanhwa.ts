import { MadaraScraper } from '../../../engine/madara';
import type { Chapter } from '../../../engine/types';

interface ClanChapterDto {
  chapter_name: string;
  chapter_slug: string;
  updated_at?: string | null;
}

interface ClanChapterListResponse {
  data: {
    chapters: ClanChapterDto[];
    last_page: number;
  };
}

const CHAPTERS_PER_PAGE = 100;

export class ClanmanhwaScraper extends MadaraScraper {
  constructor() {
    super('ClanManhwa', 'https://www.clanmanhwa.com', 'en');
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
    const first = firstRes.data as ClanChapterListResponse;
    const pages: ClanChapterDto[][] = [first.data?.chapters ?? []];
    const lastPage = first.data?.last_page ?? 1;
    for (let page = 2; page <= lastPage; page++) {
      const res = await this.get(`${base}&page=${page}`, { headers: { Accept: 'application/json' } });
      pages.push((res.data as ClanChapterListResponse).data?.chapters ?? []);
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
