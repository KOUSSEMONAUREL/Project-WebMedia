import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Manga, MangaStatus } from '../../../engine/types';

function parseStatus(text: string): MangaStatus {
  switch (text.trim().toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'on hiatus':
    case 'hiatus': return 3;
    case 'dropped':
    case 'cancelled':
    case 'canceled': return 2;
    default: return undefined;
  }
}

export class AthreascansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Athrea Scans', 'https://athreascans.com', 'en');
  }

  // Coin-gated chapters are marked with data-athlc-amount and live outside the chapter list.
  protected override chapterListSelector(): string {
    return '#chapterlist li:has(.eph-num a[href]):not(:has([data-athlc-amount]))';
  }

  protected override mangaDetailsParse($: CheerioAPI, mangaUrl: string): Partial<Manga> {
    const details = super.mangaDetailsParse($, mangaUrl);
    const status = parseStatus($(this.seriesStatusSelector).first().text());
    if (status !== undefined) details.status = status;
    return details;
  }
}
