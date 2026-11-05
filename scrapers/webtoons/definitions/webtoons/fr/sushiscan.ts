import type { CheerioAPI } from 'cheerio';
import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { Manga, MangaStatus } from '../../../engine/types';

const MONTHS: Record<string, number> = {
  janvier: 0,
  février: 1,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  août: 7,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  décembre: 11,
  decembre: 11,
};

function parseStatus(status: string): MangaStatus {
  switch (status.toLowerCase()) {
    case 'en cours':
    case 'ongoing': return 1;
    case 'terminé':
    case 'complete': return 0;
    case 'en pause':
    case 'on hold': return 3;
    case 'annulé':
    case 'canceled': return 2;
    default: return 3;
  }
}

export class SushiScanScraper extends MangaThemesiaScraper {
  constructor() {
    super('Sushi-Scan', 'https://sushiscan.net', 'fr', '/catalogue', 'dd MMMM yyyy');
  }

  protected override get seriesAuthorSelector(): string {
    return '.infotable tr:contains(Auteur) td:last-child';
  }

  protected override get seriesStatusSelector(): string {
    return '.infotable tr:contains(Statut) td:last-child';
  }

  protected override get altNamePrefix(): string {
    return 'Nom alternatif : ';
  }

  protected override mangaDetailsParse($: CheerioAPI, mangaUrl: string): Partial<Manga> {
    const details = super.mangaDetailsParse($, mangaUrl);
    const status = $(this.seriesStatusSelector).first().text().trim();
    if (status) details.status = parseStatus(status);
    return details;
  }

  protected override async searchMangaFetch(page: number, query: string, order: string): Promise<string> {
    const url = new URL(this.baseUrl);
    if (query) {
      url.pathname = page > 1 ? `/page/${page}/` : '/';
      url.searchParams.set('s', query.trim());
    } else {
      url.pathname = `${this.mangaUrlDirectory}/`;
      url.searchParams.set('page', String(page));
      if (order) url.searchParams.set('order', order);
    }
    const res = await this.get(url.toString());
    return String(res.data);
  }

  protected override parseChapterDate(date: string | null): number {
    if (!date) return 0;
    const match = /^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/.exec(date.trim());
    if (!match) return super.parseChapterDate(date);
    const month = MONTHS[match[2].toLowerCase()];
    if (month === undefined) return super.parseChapterDate(date);
    return Date.UTC(Number(match[3]), month, Number(match[1]));
  }
}
