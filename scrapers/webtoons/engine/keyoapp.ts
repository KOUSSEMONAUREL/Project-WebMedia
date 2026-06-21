import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

const CDN_HOST_REGEX = /realUrl\s*=\s*`([^`]+?)`/;
const CDN_CLEAN_REGEX = /\$\{[^}]*\}/g;
const IMG_REGEX = /url\(['"]?([^)'"]+)/;
const OLD_IMG_CDN_REGEX = /^(https?:)?\/\/cdn\d*\.keyoapp\.com/;

export abstract class KeyoappScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected showPaidChapters = false;

  protected readonly popularMangaTitleSelector: string[] = ['Popular', 'Popularie', 'Trending'];

  protected readonly descriptionSelector: string = 'div:contains(Synopsis) ~ div';
  protected readonly statusSelector: string = 'div:has(span:contains(Status)) ~ div';
  protected readonly authorSelector: string = 'div:has(span:contains(Author)) ~ div';
  protected readonly artistSelector: string = 'div:has(span:contains(Artist)) ~ div';
  protected readonly genreSelector: string = "div.grid:has(>h1) > div > a:not([title='Status'])";
  protected readonly typeSelector: string = 'div:has(span:contains(Type)) ~ div';
  protected readonly dateSelector: string = '.text-xs';
  protected readonly paidChapterSelector: string = 'img[alt~=Coin]';

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  // ============================== Popular ==============================

  protected popularMangaSelector(): string {
    return this.popularMangaTitleSelector
      .map(s => `div:contains(${s}) + div .group.overflow-hidden.grid`)
      .join(', ');
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas = $(this.popularMangaSelector()).toArray().map(el =>
      this.popularMangaFromElement($(el)),
    );
    return { mangas, hasNextPage: false };
  }

  protected popularMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    const thumbnailUrl = this.getImageUrl($el, '*[style*=background-image]');
    const linkEl = $el.find('a[href]').first();
    const url = linkEl.length > 0 ? this.absUrl(linkEl.attr('href') || '') : '';
    const title = linkEl.attr('title') || linkEl.text().trim();
    return { title, url, thumbnailUrl, lang: this.lang };
  }

  // ============================== Latest ===============================

  async getLatest(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/latest/`);
    const $ = this.$(res.data);
    const mangas = $('div.grid > div.group').toArray().map(el =>
      this.popularMangaFromElement($(el)),
    );
    return { mangas, hasNextPage: false };
  }

  // ============================== Search ===============================

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/series/?q=${encodeURIComponent(query)}`;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $(`#searched_series_page > button`).toArray()
      .filter(el => {
        const title = $(el).attr('title') || '';
        return title.toLowerCase().includes(query.toLowerCase());
      })
      .map(el => this.searchMangaFromElement($(el)));
    return { mangas, hasNextPage: false };
  }

  protected searchMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    return this.popularMangaFromElement($el);
  }

  // ============================== Details ==============================

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return this.mangaDetailsParse($, mangaUrl);
  }

  protected mangaDetailsParse($: CheerioAPI, mangaUrl: string): Partial<Manga> {
    const title = $('div.grid > h1').first().text().trim();
    const thumbnailUrl = this.getImageUrl($('body'), 'div[class*=photoURL]');
    const description = $(this.descriptionSelector).first().text().trim() || undefined;
    const author = $(this.authorSelector).first().text().trim() || undefined;
    const manga: Partial<Manga> = { title, url: mangaUrl, thumbnailUrl, lang: this.lang };
    if (author) manga.author = author;
    if (description) manga.description = description;
    return manga;
  }

  // ============================= Chapters ==============================

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('#chapters > a').toArray()
      .map(el => $(el))
      .filter($el => {
        if ($el.find('.text-sm span').text().includes('Upcoming')) return false;
        if (!this.showPaidChapters && $el.find(this.paidChapterSelector).length > 0) return false;
        return true;
      })
      .map($el => this.chapterFromElement($el));
  }

  protected chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const linkEl = $el.is('a[href]') ? $el : $el.find('a[href]').first();
    const url = linkEl.length > 0 ? this.absUrl(linkEl.attr('href') || '') : '';
    const name = $el.find('.text-sm').first().text().trim();
    const dateText = $el.find(this.dateSelector).first().text().trim();
    const dateUpload = dateText ? this.parseDate(dateText) : undefined;
    const hasPaidIcon = $el.find(this.paidChapterSelector).length > 0;
    return {
      name: hasPaidIcon ? `🔒 ${name}` : name,
      url,
      dateUpload: dateUpload || undefined,
    };
  }

  // =============================== Pages ===============================

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return this.pageListParse($);
  }

  protected pageListParse($: CheerioAPI): Page[] {
    const cdnUrl = this.getCdnUrl($);
    const uids = $('#pages > img').toArray()
      .map(el => $(el).attr('uid') || '')
      .filter(uid => uid.length > 0);

    if (uids.length > 0) {
      if (!cdnUrl) throw new Error('Chapter page URL not found');
      return uids.map((uid, index) => ({ index, imageUrl: `${cdnUrl}/${uid}` }));
    }

    return $('#pages > img').toArray()
      .map((el, index) => {
        const $el = $(el);
        const src = $el.attr('data-lazy-src') || $el.attr('data-src') || $el.attr('src') || '';
        return { index, imageUrl: src ? this.absUrl(src) : '' };
      })
      .filter(p => OLD_IMG_CDN_REGEX.test(p.imageUrl));
  }

  protected getCdnUrl($: CheerioAPI): string | null {
    const scripts = $('script').toArray();
    for (const script of scripts) {
      const html = $(script).html() || '';
      const match = CDN_HOST_REGEX.exec(html);
      if (match) {
        const cleaned = match[1].replace(CDN_CLEAN_REGEX, '');
        try {
          const hostname = new URL(cleaned).hostname;
          return `https://${hostname}/uploads`;
        } catch (err) {
          console.error(`Failed to parse CDN URL on ${this.name}: ${err instanceof Error ? err.message : err}`);
          continue;
        }
      }
    }
    return null;
  }

  // ============================= Utilities =============================

  protected getImageUrl($el: ReturnType<CheerioAPI>, selector: string): string {
    const target = $el.find(selector).first();
    if (target.length === 0) return '';
    const style = target.attr('style') || '';
    const match = IMG_REGEX.exec(style);
    if (!match) return '';
    try {
      const url = new URL(match[1], this.baseUrl);
      url.searchParams.set('w', '480');
      return url.toString();
    } catch (err) {
      console.error(`Failed to construct image URL from ${match[1]} on ${this.name}: ${err instanceof Error ? err.message : err}`);
      return match[1];
    }
  }

  protected parseDate(dateStr: string): number {
    if (dateStr.toLowerCase().includes('ago')) {
      return this.parseRelativeDate(dateStr);
    }
    return this.tryParseDate(dateStr);
  }

  protected tryParseDate(dateStr: string): number {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const match = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)/);
    if (match) {
      const month = months[match[1].toLowerCase().slice(0, 3)];
      if (month !== undefined) {
        return new Date(parseInt(match[3], 10), month, parseInt(match[2], 10)).getTime();
      }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  protected parseRelativeDate(date: string): number {
    const match = date.match(/(\d+)/);
    if (!match) return 0;
    const number = parseInt(match[1], 10);
    const now = new Date();
    const lower = date.toLowerCase();

    if (lower.includes('second')) {
      now.setSeconds(now.getSeconds() - number);
    } else if (lower.includes('minute')) {
      now.setMinutes(now.getMinutes() - number);
    } else if (lower.includes('hour')) {
      now.setHours(now.getHours() - number);
    } else if (lower.includes('day')) {
      now.setDate(now.getDate() - number);
    } else if (lower.includes('week')) {
      now.setDate(now.getDate() - number * 7);
    } else if (lower.includes('month')) {
      now.setMonth(now.getMonth() - number);
    } else if (lower.includes('year')) {
      now.setFullYear(now.getFullYear() - number);
    } else {
      return 0;
    }

    now.setSeconds(0);
    now.setMilliseconds(0);
    return now.getTime();
  }
}
