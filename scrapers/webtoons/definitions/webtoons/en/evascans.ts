import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Manga } from '../../../engine/types';

export class EvaScansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Eva Scans', 'https://evascans.net', 'en', '/series', 'yyyy/MM/dd');
  }

  protected override get seriesAltNameSelector(): string {
    return '.desktop-titles';
  }

  protected override chapterFromElement($el: ReturnType<CheerioAPI>): import('../../../engine/types').Chapter {
    const chapter = super.chapterFromElement($el);
    const a = $el.find('a').first();
    const isLocked = (a.attr('data-bs-target') !== undefined && a.attr('data-bs-target') !== '')
      || (a.attr('data-coin') !== undefined && a.attr('data-coin') !== '')
      || $el.find('.locked-badge').length > 0;
    if (isLocked) {
      chapter.name = `🔒 ${chapter.name}`;
      if (!chapter.url || chapter.url === this.baseUrl || chapter.url === `${this.baseUrl}/`) {
        const dataId = a.attr('data-id');
        if (dataId) {
          chapter.url = this.absUrl(`/?p=${dataId}`);
        }
      }
    }
    return chapter;
  }
}