import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const MEDIA_COUNT_REGEX = /\d+P( \+ \d+V)?/;
const STYLE_URL_REGEX = /background-image\s*:\s*url\('([^']+)'\)/;
const DATE_REGEX = /\d{4}\.\d{2}\.\d{2}/;
const DATE_FORMAT = /^\d{4}\.\d{2}\.\d{2}$/;

export class YellowNoteScraper extends BaseScraper {
  readonly name = '小黄书';
  readonly baseUrl = 'https://xchina.co';
  readonly lang = 'all';

  private readonly mangaSelector = 'div.list.photo-list > div.item.photo, div.list.amateur-list > div.item.amateur';
  private readonly nextPageSelector = 'div.pager:first-of-type > a.pager-next';
  private readonly imageSelector = 'div.list.photo-items > div.item.photo-image, div.list.amateur-items > div.item.amateur-image';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/photos/sort-hot/${page}.html`);
    return this.parseMangaList(res);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/photos/${page}.html`);
    return this.parseMangaList(res);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const uriPart = query.trim() ? `photos/keyword-${query}` : 'photos';
    const res = await this.get(`${uriPart}/${page}.html`);
    return this.parseMangaList(res);
  }

  private parseMangaList(res: any): SearchResult {
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $(this.mangaSelector).each((_: any, el: any) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') || '';
      const title = a.attr('title') || '';
      const styleEl = a.find('div.img').first();
      const style = styleEl.attr('style') || '';
      const urlMatch = style.match(STYLE_URL_REGEX);
      const thumbnailUrl = urlMatch?.[1] || '';
      const mediaTags = $(el).find('div.tags > div').map((_: any, t: any) => $(t).text()).get();
      const mediaCount = mediaTags.find(t => MEDIA_COUNT_REGEX.test(t)) || '';
      mangas.push({
        url: href,
        title: `${title}${mediaCount ? ' (' + mediaCount + ')' : ''}`,
        thumbnailUrl,
        lang: this.lang,
      });
    });
    const hasNextPage = $(this.nextPageSelector).length > 0;
    return { mangas, hasNextPage };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const maxPage = parseInt($('div.pager:first-of-type a.pager-num').last().text(), 10) || 1;
    const baseUrlStr = mangaUrl.replace(/\.html$/, '');

    let dateUpload: number | undefined;
    const infoCard = $('div.info-card.photo-detail').first();
    const calEl = infoCard.find('div.item:has(i.fa-calendar-days) div.text').first().text().trim();
    if (DATE_FORMAT.test(calEl)) {
      const d = new Date(calEl.replace(/\./g, '-') + 'T00:00:00Z');
      if (!isNaN(d.getTime())) dateUpload = d.getTime();
    }
    if (!dateUpload) {
      $('div.tab-content > div.info-card div.text').each((_: any, el: any) => {
        const match = $(el).text().match(DATE_REGEX);
        if (match) {
          const d = new Date(match[0].replace(/\./g, '-') + 'T00:00:00Z');
          if (!isNaN(d.getTime())) dateUpload = d.getTime();
          return false;
        }
      });
    }

    const chapters: Chapter[] = [];
    for (let page = maxPage; page >= 1; page--) {
      chapters.push({
        name: `Page ${page}`,
        url: `${baseUrlStr}/${page}.html`,
        dateUpload,
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $(this.imageSelector).each((i: number, el: any) => {
      const style = $(el).find('div.img').first().attr('style') || '';
      const match = style.match(STYLE_URL_REGEX);
      if (match?.[1]) {
        pages.push({ index: i, imageUrl: match[1] });
      }
    });
    return pages;
  }
}
