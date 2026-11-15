import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';
import type { Chapter, Manga } from '../../../engine/types';

interface ChaptersResponse {
  data?: {
    html?: string;
  };
}

export class WebtoonScanScraper extends MadaraScraper {
  protected override readonly mangaSubString = 'manhwa';
  constructor() {
    super('WebtoonScan', 'https://webtoonscan.org', 'en', 'd MMM yy');
  }

  protected override mangaDetailsParse(
    $: CheerioAPI,
    mangaUrl: string,
  ): Partial<Manga> {
    const manga = super.mangaDetailsParse($, mangaUrl);
    const type = $(this.seriesTypeSelector).first().text().trim();
    if (type && manga.genre) {
      manga.genre =
        manga.genre
          .split(', ')
          .filter(genre => genre !== type)
          .join(', ') || undefined;
    }
    return manga;
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const html = String(res.data);
    const mangaId = /manga_id["']?\s*:\s*["']?(\d+)/.exec(html)?.[1];
    if (!mangaId) return super.getChapterList(mangaUrl);

    const body = new URLSearchParams();
    body.append('action', 'wp-manga-get-chapters');
    body.append('manga_id', mangaId);
    body.append('offset', '0');

    const chaptersRes = await this.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, body, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: mangaUrl,
      },
    });

    const data =
      typeof chaptersRes.data === 'string'
        ? (JSON.parse(chaptersRes.data) as ChaptersResponse)
        : (chaptersRes.data as ChaptersResponse);
    const chapterHtml = data.data?.html ?? '';
    if (!chapterHtml) return super.getChapterList(mangaUrl);

    const $ = this.$(chapterHtml);
    return $(this.chapterListSelectorStr)
      .toArray()
      .map(el => this.chapterFromElement($(el)));
  }
}
