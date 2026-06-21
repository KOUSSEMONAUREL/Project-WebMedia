import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Page } from '../../../engine/types';

export class ErosScansScraper extends MangaThemesiaScraper {
  constructor() { super('Scythe Scans', 'https://scythescans.com', 'en'); }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    this.countViews($, chapterUrl);

    const htmlPages = $(this.pageSelector).toArray()
      .map(el => this.imageAttr($(el)))
      .filter(Boolean)
      .map((imgUrl, i) => ({ index: i, imageUrl: imgUrl! }));
    if (htmlPages.length > 0) return htmlPages;

    const script = $('script[src^="data:text/javascript;base64,dHNfcmVhZGVyLnJ1bih7"]').first();
    if (script.length === 0) return [];

    const src = script.attr('src') || '';
    const b64 = src.substring(src.indexOf('base64,') + 7);
    const decoded = Buffer.from(b64, 'base64').toString('utf-8');

    const match = decoded.match(/"images"\s*:\s*(\[.*?\])/);
    if (!match) return [];

    try {
      const imageList = JSON.parse(match[1]) as string[];
      return imageList.map((imgUrl, i) => ({ index: i, imageUrl: imgUrl }));
    } catch (err) {
      console.error(`Failed to parse image list JSON on ${this.name}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
