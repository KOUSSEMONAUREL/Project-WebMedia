import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';

export class VioletScansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Violet Scans', 'https://violetscans.org', 'en', '/comics');
  }

  protected override searchMangaSelector(): string {
    return '.utao .uta .imgu, .listupd .bs .bsx:not(:has(.novelabel)), .listo .bs .bsx:not(:has(.novelabel))';
  }

  protected override chapterListSelector(): string {
    return '#chapterlist li:not(:has(svg))';
  }

  protected override mangaDetailsParse($: CheerioAPI, mangaUrl: string) {
    const manga = super.mangaDetailsParse($, mangaUrl);
    const altText = $('.alternative .desktop-titles').first().text().trim();
    if (altText) {
      const altNames = altText.split(/[|/]/).map(s => s.trim()).filter(Boolean);
      if (altNames.length > 0) {
        const baseDesc = (manga.description || '').split(this.altNamePrefix)[0].trim();
        const altBlock = altNames.map(n => `- ${n}`).join('\n');
        const prefix = this.altNamePrefix.trim();
        manga.description = baseDesc ? `${baseDesc}\n\n${prefix}\n${altBlock}` : `${prefix}\n${altBlock}`;
      }
    }
    return manga;
  }
}
