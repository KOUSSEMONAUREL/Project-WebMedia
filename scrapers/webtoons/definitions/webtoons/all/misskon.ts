import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const FULL_DATE_REGEX = /\/(\d{4}\/\d{2}\/\d{2})\//;
const YEAR_MONTH_REGEX = /\/(\d{4}\/\d{2})\//;

export class MissKonScraper extends BaseScraper {
  readonly name = 'MissKon';
  readonly baseUrl = 'https://misskon.com';
  readonly lang = 'all';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/page/${page}/`);
    url.searchParams.set('s', query);
    const res = await this.get(url.toString());
    return this._parseMangaList(res.data, 'div.content > div.pagination > span.current + a');
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/top3/`);
    return this._parseMangaList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/page/${page}`);
    return this._parseMangaList(res.data, '.current + a.page');
  }

  private _mangaFromElement(el: any, $: any): Manga {
    const titleEl = $(el).find('.post-box-title').first();
    const link = titleEl.find('a').first();
    const thumbnail = $(el).find('.post-thumbnail img').first();
    return {
      title: titleEl.text(),
      url: this.absUrl(link.attr('href') || ''),
      thumbnailUrl: this.absUrl(thumbnail.attr('data-src') || ''),
      lang: this.lang,
    };
  }

  private _parseMangaList(html: string, nextPageSelector?: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('article.item-list').toArray().map(el => this._mangaFromElement(el, $));
    const hasNextPage = nextPageSelector ? $(nextPageSelector).length > 0 : false;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const postInner = $('article > .post-inner').first();
    const title = postInner.find('.post-title').text();
    return { title: title || undefined, url: mangaUrl, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const dateUploadSrc = $('.entry img').first().attr('data-src') || '';
    let dateUpload: number | undefined;
    const fullMatch = FULL_DATE_REGEX.exec(dateUploadSrc);
    const yearMonthMatch = YEAR_MONTH_REGEX.exec(dateUploadSrc);
    if (fullMatch) {
      dateUpload = new Date(fullMatch[1].replace(/\//g, '-')).getTime();
    } else if (yearMonthMatch) {
      dateUpload = new Date(`${yearMonthMatch[1]}/01`.replace(/\//g, '-')).getTime();
    }
    const maxPageText = $('div.page-link:first-of-type a.post-page-numbers').last().text();
    const maxPage = maxPageText ? parseInt(maxPageText) : 1;
    const chapters: Chapter[] = [];
    for (let i = maxPage; i >= 1; i--) {
      chapters.push({ name: `Page ${i}`, url: `${mangaUrl}/${i}`, dateUpload });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.post-inner > div.entry > p > img').toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('data-src') || ''),
    }));
  }
}
