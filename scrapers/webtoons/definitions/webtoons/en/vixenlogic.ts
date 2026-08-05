import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const DATE_FORMAT = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class VixenLogicScraper extends BaseScraper {
  readonly name = 'Vixen Logic';
  readonly baseUrl = 'https://www.vixenlogic.com';
  readonly lang = 'en';

  private manga(): Manga {
    return {
      title: 'Vixen Logic',
      url: `${this.baseUrl}/`,
      thumbnailUrl: `${this.baseUrl}/wp-content/uploads/2026/06/VL_Cover_Toocheke.png`,
      author: 'tootaloo and foxboy83',
      lang: this.lang,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return { mangas: [this.manga()], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return { mangas: [this.manga()], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return this.manga();
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get('/archives/');
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.comic-item').each((_, el) => {
      const item = $(el);
      const href = item.parent().attr('href');
      if (!href) return;
      const name = item.find('.comic-title').first().text().trim();
      if (!name) return;
      chapters.push({
        name,
        url: this.absUrl(href),
        dateUpload: this.parseDate(item.find('.comic-post-date').first().text().trim()),
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('#comic p a img').each((index, el) => {
      const src = $(el).attr('src') || '';
      if (src) pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private parseDate(text: string): number | undefined {
    const value = text.trim();
    const lower = value.toLowerCase();
    const now = new Date();
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (lower === 'today') return startOfToday;
    if (lower === 'yesterday') return startOfToday - 86_400_000;
    const match = DATE_FORMAT.exec(value);
    if (!match) return undefined;
    const month = MONTHS.indexOf(match[1]);
    if (month === -1) return undefined;
    return Date.UTC(parseInt(match[3], 10), month, parseInt(match[2], 10));
  }
}
