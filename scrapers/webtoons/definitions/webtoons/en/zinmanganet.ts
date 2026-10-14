import { MadaraScraper } from '../../../engine/madara';
import type { Chapter } from '../../../engine/types';

interface ZinmangaChapterDto {
  chapter_name: string;
  chapter_slug: string;
  updated_at?: string;
}

interface ZinmangaChaptersData {
  chapters: ZinmangaChapterDto[];
  last_page: number;
}

interface ZinmangaChaptersResponse {
  data: ZinmangaChaptersData;
}

export class ZinmanganetScraper extends MadaraScraper {
  constructor() {
    super('Zinmanga.net', 'https://www.zinmanga.net', 'en');
  }

  protected override readonly filterNonMangaItems = false;
  protected override readonly useNewChapterEndpoint = true;

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean)[1];
    if (!slug) return [];
    const base = `${this.baseUrl}/api/comics/${encodeURIComponent(slug)}/chapters?per_page=100&order=desc`;
    const firstRes = await this.get(`${base}&page=1`);
    const first = firstRes.data as ZinmangaChaptersResponse;
    const pages: ZinmangaChapterDto[][] = [first.data.chapters];
    for (let page = 2; page <= first.data.last_page; page++) {
      const res = await this.get(`${base}&page=${page}`);
      pages.push((res.data as ZinmangaChaptersResponse).data.chapters);
    }
    const seen = new Set<string>();
    return pages.flat()
      .filter((dto) => !seen.has(dto.chapter_slug) && (seen.add(dto.chapter_slug), true))
      .map((dto) => ({
        name: dto.chapter_name,
        url: `/manga/${slug}/${dto.chapter_slug}`,
        dateUpload: dto.updated_at ? Date.parse(dto.updated_at) || undefined : undefined,
      }));
  }
}
