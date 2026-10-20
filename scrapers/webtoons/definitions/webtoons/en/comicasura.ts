import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ComicasuraScraper extends MangaThemesiaScraper {
  constructor() {
    super('Comic Asura', 'https://comicasura.net', 'en');
  }

  protected override get seriesDetailsSelector(): string {
    return '.bg-\\[\\#222222\\]:has(h1)';
  }

  protected override get seriesTitleSelector(): string {
    return '.comic-title-content';
  }

  protected override get seriesThumbnailSelector(): string {
    return 'img[alt=poster]';
  }

  protected override get seriesDescriptionSelector(): string {
    return '.comic-content.mobile';
  }

  protected override get seriesGenreSelector(): string {
    return 'div.hidden div:contains(Genres) + div > a';
  }

  protected override get seriesStatusSelector(): string {
    return 'div:contains(Status) + div';
  }

  protected override searchMangaSelector(): string {
    return '.grid > a[href*=manga], .flex-wrap.flex a[href*=manga]';
  }

  protected override searchMangaNextPageSelector(): string | null {
    return 'a:has(img[alt=Next])';
  }

  protected override searchMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    const img = $el.find('img').first();
    return {
      title: img.attr('title')?.trim() ?? '',
      url: this.absUrl($el.attr('href') ?? ''),
      thumbnailUrl: this.imageAttr(img) ?? '',
      lang: this.lang,
    };
  }

  protected override chapterListSelector(): string {
    return '.chapter-items';
  }

  protected override chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const urlElements = $el.find('a');
    const href = urlElements.attr('href') ?? '';
    const name = $el.find('.text-sm.text-white').first().text().trim();
    const dateRaw = $el.find('.text-xs.text-\\[\\#A2A2A2\\]:not(:has(span))').first().text().trim()
      .replace(/(\d)(st|nd|rd|th)/g, '$1');
    const dateUpload = this.parseChapterDate(dateRaw) || undefined;
    return {
      name,
      url: href.startsWith('http') ? this.relativize(href) : href,
      dateUpload,
    };
  }

  protected override get pageSelector(): string {
    return 'div > img.object-cover.mx-auto';
  }

  protected override async searchMangaFetch(page: number, query: string, order: string): Promise<string> {
    const url = new URL(`${this.baseUrl}/advanced-search`);
    if (query) url.searchParams.set('name', query.trim());
    url.searchParams.set('page', String(page));
    if (order === 'popular' || order === 'rating') url.searchParams.set('sort', 'rating');
    else if (order === 'update' || order === 'latest') url.searchParams.set('sort', 'latest');
    const res = await this.get(url.toString());
    return String(res.data);
  }

  protected override parseChapterDate(date: string | null): number {
    if (!date) return 0;
    const trimmed = date.trim();
    if (!trimmed) return 0;
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  private relativize(href: string): string {
    try {
      const u = new URL(href, this.baseUrl);
      return u.pathname + u.search;
    } catch {
      return href;
    }
  }
}
