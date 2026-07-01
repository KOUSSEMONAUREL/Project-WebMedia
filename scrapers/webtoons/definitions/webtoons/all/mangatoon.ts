import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const ONGOING_STATUS = [
  '连载', 'on going', 'sedang berlangsung', 'tiếp tục cập nhật',
  'en proceso', 'atualizando', 'เซเรียล', 'en cours', '連載中',
];

const COMPLETED_STATUS = [
  '完结', 'completed', 'tamat', 'đã full', 'terminada',
  'concluído', 'จบ', 'fin',
];

const POSTER_SUFFIX = /(jpg)-poster(.*)\d+?$/;
const PAID_CHECK_BREAKPOINTS = [5, 10, 15, 20];

export class MangaToonScraper extends BaseScraper {
  readonly name = 'MangaToon (Limited)';
  readonly baseUrl = 'https://mangatoon.mobi';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const path = 'hot';
    const res = await this.get(`${this.baseUrl}/en/genre/${path}?type=1&page=${page - 1}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div.genre-content div.items a').map((_: any, el: any) => this.mangaFromElement($(el))).get();
    const hasNextPage = $('span.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(page: number): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/en/search?word=${encodeURIComponent(query)}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div.comics-result div.recommend-item:has(a[abs\\:href^="' + this.baseUrl + '"])').map((_: any, el: any) => {
      const $el = $(el);
      return {
        title: $el.find('div.recommend-comics-title').text(),
        thumbnailUrl: this.normalPosterUrl(this.imgAttr($el.find('img'))), lang: this.lang,
        url: $el.find('a').first().attr('abs:href') || '',
      };
    }).get();
    const hasNextPage = $('span.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Manga> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const locale = 'en';
    const manga: Manga = {
      title: $('div.detail-title h1').text() || $('h1.entry-title').text() || '',
      url: mangaUrl,
      thumbnailUrl: '',
      lang: this.lang,
      author: $('div.detail-author-name span').text().split(': ')[1] || '',
      description: $('div.detail-description-short p').map((_: any, el: any) => $(el).text()).get().join('\n\n'),
      genre: $('div.detail-tags-info span').text()
        .split('/')
        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
        .sort()
        .join(', '),
      status: this.toStatus($('div.detail-status').text()) as 0 | 1 | 2 | 3 | undefined,
    };
    const thumbnail = this.normalPosterUrl(this.imgAttr($('div.detail-img img')));
    if (!thumbnail.includes('cartoon-big-images')) {
      manga.thumbnailUrl = thumbnail;
    }
    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl + '/episodes');
    const $ = this.$(res.data);
    const chapterList: Chapter[] = $('a.episode-item-new').map((_: any, el: any) => {
      const $el = $(el);
      return {
        name: $el.find('div.episode-title-new:last-child').text(),
        chapterNumber: parseFloat($el.find('div.episode-number').text()) || -1,
        dateUpload: this.parseDate($el.find('div.episode-date span.open-date').text()),
        url: $el.attr('abs:href') || '',
      };
    }).get();

    const firstPaid = PAID_CHECK_BREAKPOINTS.find((breakpoint: number) => {
      if (breakpoint > chapterList.length) return false;
      try {
        const pages = this.getPageList(chapterList[breakpoint - 1].url);
        return false;
      } catch (err) {
        console.error(`Failed to get page list for chapter: ${err instanceof Error ? err.message : err}`);
        return true;
      }
    });

    const result = firstPaid != null ? chapterList.slice(0, firstPaid - 1) : chapterList;
    return result.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages = $('div.pictures div img:first-child').map((i: number, el: any) => ({
      index: i,
      imageUrl: this.imgAttr($(el)),
    })).get();
    if (pages.length === 0) {
      throw new Error('This chapter is paid and can\'t be read. Use the MangaToon official app to purchase and read it.');
    }
    return pages;
  }

  private mangaFromElement($el: any): Manga {
    return {
      title: $el.find('div.content-title').text(),
      thumbnailUrl: this.normalPosterUrl(this.imgAttr($el.find('img'))),
      url: $el.attr('abs:href') || '',
      lang: this.lang,
    };
  }

  private imgAttr($el: any): string {
    const attr = $el.attr('data-src');
    return attr ? $el.attr('abs:data-src') : $el.attr('abs:src');
  }

  private normalPosterUrl(url: string | undefined): string {
    return url ? url.replace(POSTER_SUFFIX, '$1') : '';
  }

  private toStatus(status: string): number {
    const lower = status.toLowerCase();
    if (ONGOING_STATUS.some(s => lower.includes(s))) return 1;
    if (COMPLETED_STATUS.some(s => lower.includes(s))) return 2;
    return 0;
  }

  private parseDate(dateStr: string): number {
    if (!dateStr) return 0;
    return Date.parse(dateStr);
  }
}
