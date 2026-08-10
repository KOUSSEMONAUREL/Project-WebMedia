import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Chapter } from '../../../engine/types';

export class MadarascansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Madara Scans', 'https://madarascans.org', 'en', '/series');
  }

  protected override searchMangaSelector(): string {
    return 'div.listupd>div, div.legend-inner';
  }

  protected override searchMangaFromElement($el: ReturnType<CheerioAPI>) {
    const img = $el.find('img').first();
    const titleEl = $el.find('h3.card-v-title > a, h3.legend-title > a').first();
    return {
      title: titleEl.text().trim(),
      url: this.absUrl(titleEl.attr('href') || ''),
      thumbnailUrl: this.imageAttr(img) || '',
      lang: this.lang,
    };
  }

  protected override get seriesDetailsSelector(): string {
    return 'div.lh-container';
  }

  protected override get seriesTitleSelector(): string {
    return 'h1.lh-title';
  }

  protected override get seriesDescriptionSelector(): string {
    return 'div.lh-story > #manga-story';
  }

  protected override get seriesAltNameSelector(): string {
    return '.fa-info-circle';
  }

  protected override get seriesGenreSelector(): string {
    return '.lh-genres > .lh-genre-tag';
  }

  protected override get seriesStatusSelector(): string {
    return 'span.status-badge-lux';
  }

  protected override get seriesThumbnailSelector(): string {
    return '.lh-poster > img';
  }

  protected override chapterListSelector(): string {
    return '.ch-item';
  }

  protected override chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const a = $el.find('a').first();
    const url = this.absUrl(a.attr('href') || '');
    const chapterName = $el.find('.ch-num').first().text().trim();
    const name = chapterName || a.text().trim();
    const locked = !$el.hasClass('free');
    const dateText = $el.find('.ch-date').first().text().trim();
    const dateUpload = this.parseChapterDate(dateText) || undefined;
    return { name: locked ? `🔒 ${name}` : name, url, dateUpload };
  }
}
