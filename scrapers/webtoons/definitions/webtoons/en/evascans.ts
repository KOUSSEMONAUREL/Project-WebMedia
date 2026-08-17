import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Manga } from '../../../engine/types';

export class EvaScansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Eva Scans', 'https://evascans.org', 'en', '/series', 'yyyy/MM/dd');
  }

  protected override searchMangaSelector(): string {
    return 'div.manga-card-v, .listupd .bs .bsx';
  }

  protected override searchMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    const titleEl = $el.find('h3.card-v-title > a').first();
    const linkEl = titleEl.length > 0 ? titleEl : $el.find('a').first();
    const imgEl = $el.find('.card-v-cover img').first();
    const fallbackImg = $el.find('img').first();
    return {
      title: linkEl.text().trim(),
      url: this.absUrl(linkEl.attr('href') || ''),
      thumbnailUrl: this.imageAttr(imgEl.length > 0 ? imgEl : fallbackImg) || '',
      lang: this.lang,
    };
  }

  protected override chapterListSelector(): string {
    return '#chapterlist li:not(:has(.locked-badge))';
  }

  protected override get pageSelector(): string {
    return 'div#readerArea img';
  }

  protected override get seriesDetailsSelector(): string {
    return '.series-premium-header';
  }

  protected override get seriesTitleSelector(): string {
    return '.series-title-main';
  }

  protected override get seriesThumbnailSelector(): string {
    return '.series-poster-premium img, .poster-box img';
  }

  protected override get seriesGenreSelector(): string {
    return '.series-genres-wrap .gen-tag';
  }

  protected override get seriesTypeSelector(): string {
    return '.stat-v-box:has(.stat-v-label:contains(Type)) .stat-v-value';
  }

  protected override get seriesStatusSelector(): string {
    return '.stat-v-box:has(.stat-v-label:contains(Status)) .stat-v-value';
  }

  protected override mangaDetailsParse($: CheerioAPI, mangaUrl: string): Partial<Manga> {
    const manga = super.mangaDetailsParse($, mangaUrl);

    const stats: Record<string, string> = {};
    $('.stat-v-box').each((_, el) => {
      const label = $(el).find('.stat-v-label').first().text().trim();
      const value = $(el).find('.stat-v-value').first().text().trim();
      if (label) stats[label] = value;
    });

    const rating = parseFloat(stats['Rating'] ?? '');
    const views = stats['Views']?.trim();
    const synopsis = $('.synopsis-full p')
      .toArray()
      .map(el => $(el).text().trim())
      .filter(Boolean)
      .join('\n\n')
      || $('.synopsis-short p').first().text().trim()
      || $('meta[name=description]').attr('content')?.trim()
      || '';
    const altNames = $('.series-title-alt').first().text()
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);

    const parts: string[] = [];
    if (!isNaN(rating) && rating > 0) parts.push(`Rating: ${rating.toFixed(2)}/10`);
    if (views) parts.push(`Views: ${views}`);
    if (synopsis) parts.push(`Synopsis: ${synopsis}`);
    if (altNames.length > 0) {
      parts.push(`Alternative Names:\n${altNames.map(name => `- ${name}`).join('\n')}`);
    }
    if (parts.length > 0) manga.description = parts.join('\n\n');

    return manga;
  }
}