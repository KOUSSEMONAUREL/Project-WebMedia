import { BaseScraper } from '../../../engine/base';
import type { CheerioAPI } from 'cheerio';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface Manga18fxMangaDto {
  url: string;
  title: string;
  thumbnailUrl: string;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export class Manga18fxScraper extends BaseScraper {
  readonly name = 'Manga18fx';
  readonly baseUrl = 'https://manga18fx.com';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/hot-manga`);
    if (page !== 1) url.searchParams.set('page', page.toString());
    const response = await this.get(url.toString());
    return this.parseListing(response.data);
  }

  async getLatest(page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/page/${page}`);
    return this.parseListing(response.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    if (!query) {
      throw new Error('Select a genre to search');
    }
    const fixedQuery = query.replace(/'/g, '\u2019');
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', fixedQuery);
    if (page !== 1) url.searchParams.set('page', page.toString());
    const response = await this.get(url.toString());
    return this.parseListing(response.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.site-body > .bixbox:last-child .page-item').each((_, el) => {
      const manga = this.mangaFromElement($(el));
      if (manga) mangas.push(manga);
    });
    const hasNextPage = $('#blog-pager li.next:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  private mangaFromElement($el: ReturnType<CheerioAPI>): Manga | null {
    const linkEl = $el.find('.tt > a').first();
    const href = this.absUrl(linkEl.attr('href') || '');
    if (!href) return null;
    const imgEl = $el.find('a img[data-src]').first();
    const thumbnailUrl = this.absUrl(imgEl.attr('src') || '');
    const title = linkEl.text().trim();
    return { url: href.replace(this.baseUrl, ''), title, thumbnailUrl, lang: this.lang };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);

    const descriptionParts: string[] = [];
    const rate = $('#averagerate').text().trim();
    const rateCount = parseInt($('#countrate').text().trim(), 10);
    if (rate) {
      descriptionParts.push(`Rating: ${this.ratingString(rate, isNaN(rateCount) ? 0 : rateCount)}`);
    }
    const commentsText = $('.list-comments > h4').text().trim().split(' ')[0];
    const comments = parseInt(commentsText, 10);
    if (!isNaN(comments)) descriptionParts.push(`Comments: ${comments}`);
    const bookmarksText = $('.sumbmrk').text().trim().split(' ')[0];
    const bookmarks = parseInt(bookmarksText, 10);
    if (!isNaN(bookmarks)) descriptionParts.push(`Bookmarks: ${bookmarks}`);
    const synopsis = $('.dsct').text().trim();
    if (synopsis) descriptionParts.push(synopsis);
    const alternativeRaw = this.summaryContent($, 'Alternative');
    if (alternativeRaw) {
      const alternatives = alternativeRaw.split(' / ');
      if (alternatives[0] !== 'N/A') {
        descriptionParts.push('Alternative titles:');
        alternatives.forEach(alt => descriptionParts.push(`- ${alt}`));
      }
    }

    const statusText = this.summaryContent($, 'Status');
    const status: MangaStatus = statusText === 'Ongoing' ? 1 : statusText === 'Completed' ? 0 : 3;

    const authorText = $('.author-content > a').map((_, el) => $(el).text()).get().join(', ');
    const artistText = $('.artist-content > a').map((_, el) => $(el).text()).get().join(', ');
    const type = this.summaryContent($, 'Type');
    const genres = $('.genres-content > a').map((_, el) => $(el).text()).get();
    const genre = [type, ...genres].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');

    return {
      url: mangaUrl,
      title: $('.post-title > h1').text().trim(),
      thumbnailUrl: this.absUrl($('.summary_image img').first().attr('src') || ''),
      author: authorText && authorText !== 'Updating' ? authorText : undefined,
      artist: artistText && artistText !== 'Updating' ? artistText : undefined,
      status,
      description: descriptionParts.join('\n') || undefined,
      genre: genre || undefined,
    };
  }

  private summaryContent($: CheerioAPI, heading: string): string {
    return $(`.summary-heading:has(h5:contains(${heading})) + .summary-content`).text().trim();
  }

  private ratingString(rate: string, rateCount: number): string {
    const ratingValue = parseFloat(rate) || 0;
    let ratingStar: string;
    if (ratingValue >= 4.75) ratingStar = '\u2605\u2605\u2605\u2605\u2605';
    else if (ratingValue >= 4.25) ratingStar = '\u2605\u2605\u2605\u2605\u272c';
    else if (ratingValue >= 3.75) ratingStar = '\u2605\u2605\u2605\u2605\u2606';
    else if (ratingValue >= 3.25) ratingStar = '\u2605\u2605\u2605\u272c\u2606';
    else if (ratingValue >= 2.75) ratingStar = '\u2605\u2605\u2605\u2606\u2606';
    else if (ratingValue >= 2.25) ratingStar = '\u2605\u2605\u272c\u2606\u2606';
    else if (ratingValue >= 1.75) ratingStar = '\u2605\u2605\u2606\u2606\u2606';
    else if (ratingValue >= 1.25) ratingStar = '\u2605\u272c\u2606\u2606\u2606';
    else if (ratingValue >= 0.75) ratingStar = '\u2605\u2606\u2606\u2606\u2606';
    else if (ratingValue >= 0.25) ratingStar = '\u272c\u2606\u2606\u2606\u2606';
    else ratingStar = '\u2606\u2606\u2606\u2606\u2606';
    if (ratingValue <= 0) return '';
    return rateCount > 0 ? `${ratingStar} ${rate} (${rateCount})` : `${ratingStar} ${rate}`;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const chapters: Chapter[] = [];
    $('#chapterlist li.a-h').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a.chapter-name').first();
      const href = this.absUrl(link.attr('href') || '');
      const dateText = $el.find('.chapter-time').first().text();
      chapters.push({
        url: href.replace(this.baseUrl, ''),
        name: link.text().trim(),
        dateUpload: this.parseChapterDate(dateText),
      });
    });
    return chapters;
  }

  private parseChapterDate(text: string): number | undefined {
    const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{2})$/.exec(text.trim());
    if (!m) return undefined;
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return undefined;
    return Date.UTC(2000 + Number(m[3]), month, Number(m[1]));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('.page-break > img').each((i, el) => {
      pages.push({ index: i, imageUrl: this.absUrl($(el).attr('src') || '') });
    });
    if (pages.length === 0) throw new Error('Unable to find script with image data');
    return pages;
  }
}
