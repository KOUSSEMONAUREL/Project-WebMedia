import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

export class Manhwa18ccScraper extends MadaraScraper {
  constructor() { super('Manhwa18.cc', 'https://manhwa18.cc', 'all'); }
  protected override readonly mangaSubString = 'webtoons';
  protected override readonly mangaDetailsSelectorDescription = 'div.panel-story-description div.dsct';

  private archiveUrl(page: number, order: string): string {
    const path = page > 1 ? `/webtoons/${page}/` : '/webtoons/';
    const params = order ? `?orderby=${encodeURIComponent(order)}` : '';
    return `${this.baseUrl}${path}${params}`;
  }

  private parseArchive(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('div.manga-item').toArray()
      .filter(el => $(el).find('h3 a[title$="Raw"]').length === 0)
      .map(el => this.archiveManga($(el)))
      .filter((m): m is Manga => m !== null);
    const hasNextPage = $('ul.pagination li.next a').length > 0;
    return { mangas, hasNextPage };
  }

  private archiveManga($el: ReturnType<CheerioAPI>): Manga | null {
    const link = $el.find('div.manga-item div.data a, div.data a').first();
    const href = link.length > 0 ? link.attr('href') || '' : '';
    if (!href) return null;
    const img = $el.find('img').first();
    const thumb = img.length > 0 ? this.imageFromElement(img) : null;
    return {
      title: link.text().trim(),
      url: this.absUrl(href),
      thumbnailUrl: thumb || '',
      lang: this.lang,
    };
  }

  public override async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.archiveUrl(page, 'trending'));
    return this.parseArchive(res.data);
  }

  public override async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.archiveUrl(page, 'latest'));
    return this.parseArchive(res.data);
  }

  public override async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query) {
      const res = await this.get(this.archiveUrl(page, ''));
      return this.parseArchive(res.data);
    }
    const url = page > 1
      ? `${this.baseUrl}/search/?q=${encodeURIComponent(query)}&post_type=wp-manga&page=${page}`
      : `${this.baseUrl}/?q=${encodeURIComponent(query)}&post_type=wp-manga`;
    const res = await this.get(url);
    return this.parseArchive(res.data);
  }

  public override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('li.a-h').toArray().map((el): Chapter | null => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.length > 0 ? link.attr('href') || '' : '';
      if (!href) return null;
      const dateText = $el.find('img:not(.thumb)').first().attr('alt')
        || $el.find('span a').first().attr('title')
        || $el.find('span.chapter-time').first().text();
      return {
        name: link.text().trim(),
        url: this.absUrl(href),
        dateUpload: this.parseDateStrict(dateText),
      };
    }).filter((ch): ch is Chapter => ch !== null);
  }

  private parseDateStrict(text: string | undefined): number | undefined {
    const t = (text || '').trim();
    if (!t) return undefined;
    const looksLikeDate = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t)
      || /^(today|yesterday)/i.test(t)
      || /\d/.test(t) && /(ago|days?|hours?|mins?|minutes?|secs?|seconds?|weeks?|months?|years?)/i.test(t);
    if (!looksLikeDate) return undefined;
    return this.parseChapterDate(t) || undefined;
  }

  public override async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.read-content img').toArray().map((el, index) => {
      const $el = $(el);
      const img = $el.is('img') ? $el : $el.find('img').first();
      return { index, imageUrl: this.imageFromElement(img) || '' };
    }).filter(p => p.imageUrl.length > 0);
  }
}
