import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Chapter } from '../../../engine/types';

export class ThunderScansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Thunder Scans', 'https://en-thunderscans.com', 'en', '/comics');
  }

  protected override searchMangaSelector(): string {
    return '.listupd .manga-card-v';
  }

  protected override searchMangaFromElement($el: ReturnType<CheerioAPI>) {
    const manga = super.searchMangaFromElement($el);
    const titleEl = $el.find('.bigor .tt, h3 a').first();
    const title = titleEl.text().trim() || $el.find('a').first().attr('title') || manga.title;
    return { ...manga, title };
  }

  protected override get seriesDetailsSelector(): string {
    return 'div.lh-container';
  }

  protected override get seriesTitleSelector(): string {
    return '.lh-title';
  }

  protected override get seriesDescriptionSelector(): string {
    return '#manga-story';
  }

  protected override get seriesGenreSelector(): string {
    return '.lh-genres a';
  }

  protected override get seriesStatusSelector(): string {
    return '.status-badge-lux';
  }

  protected override get seriesThumbnailSelector(): string {
    return '.lh-poster img';
  }

  protected override chapterListSelector(): string {
    return '#chapters-list-container .ch-item';
  }

  protected override chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const a = $el.find('a').first();
    const url = this.absUrl(a.attr('href') || '');
    const chapterNum = $el.find('.ch-num').first().text().trim();
    const name = chapterNum || a.text().trim();
    const dateText = $el.find('.ch-date').first().text().trim();
    const dateUpload = this.parseChapterDate(dateText) || undefined;
    return { name, url, dateUpload };
  }
}
