import { IkenScraper } from '../../../engine/iken';
import type { Chapter } from '../../../engine/types';

interface VortexChapter {
  id: number;
  slug: string;
  number: string | number;
  title?: string;
  createdAt: string;
  chapterStatus?: string | null;
  isAccessible: boolean;
  isLocked?: boolean;
  isTimeLocked?: boolean;
  price?: number;
  chapterPurchased?: boolean;
  mangaPost?: { slug?: string };
}

interface VortexChaptersResponse {
  post: { chapters: VortexChapter[] };
}

export class VortexscansScraper extends IkenScraper {
  constructor() {
    super('Vortex Scans', 'https://vortexscans.org', 'en');
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const separator = mangaUrl.lastIndexOf('#');
    const slug = mangaUrl.substring(0, separator);
    const id = mangaUrl.substring(separator + 1);
    if (separator < 0 || !/^\d+$/.test(id)) {
      return super.getChapterList(mangaUrl);
    }

    // `/api/post` ne renvoie plus `chapters` pour Vortex (totalChapterCount
    // reste renseigne). L'upstream bascule alors sur `/api/chapters?postId=`;
    // le moteur partage ne le fait pas encore, donc on le fait ici pour ne pas
    // toucher les autres sources Iken.
    const res = await this.get(`${this.apiUrl}/api/chapters?postId=${id}`);
    const data = res.data as VortexChaptersResponse;
    const chapters = data.post?.chapters ?? [];
    return chapters
      .filter((ch) => ch.isAccessible && !ch.isLocked && !ch.isTimeLocked)
      .filter((ch) => !(ch.chapterPurchased === false && (ch.price ?? 0) !== 0))
      .map((ch) => this.chapterFromApi(
        { ...ch, number: String(ch.number), chapterStatus: ch.chapterStatus ?? '' },
        slug || ch.mangaPost?.slug || '',
      ));
  }
}

export default VortexscansScraper;
