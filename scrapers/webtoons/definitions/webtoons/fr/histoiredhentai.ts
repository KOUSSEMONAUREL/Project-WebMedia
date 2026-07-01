import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

export class HistoiredhentaiScraper extends BaseScraper {
  readonly name = 'HistoireDHentai';
  readonly baseUrl = 'https://hhentai.fr';
  readonly lang = 'fr';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get('/', { params: { s: '', post_type: 'wp-manga', page: String(page) } });
    return { mangas: this._parseMangaList(this.$(res.data)), hasNextPage: this._hasNextPage(res.data) };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get('/', { params: { s: '', post_type: 'wp-manga', m_orderby: 'latest', page: String(page) } });
    return { mangas: this._parseMangaList(this.$(res.data)), hasNextPage: this._hasNextPage(res.data) };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get('/', { params: { s: query, post_type: 'wp-manga', page: String(page) } });
    return { mangas: this._parseMangaList(this.$(res.data)), hasNextPage: this._hasNextPage(res.data) };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('li.wp-manga-chapter').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim();
      const dateText = $(el).find('span.chapter-release-date i, span.date').text().trim();
      chapters.push({ name, url: href, dateUpload: this._parseDate(dateText) });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.reading-content img, #readerarea img, .text-center img').each((i, el) => {
      const src = $(el).attr('data-src') ?? $(el).attr('src') ?? $(el).attr('data-lazy-src') ?? '';
      if (src) pages.push({ imageUrl: this.absUrl(src), index: i });
    });
    return pages;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.post-title h1').text().trim() || $('h1.entry-title').text().trim();
    const thumbnailUrl = $('.summary_image img').first().attr('data-src') ?? $('.summary_image img').first().attr('src') ?? '';
    const author = $('.author-content a').text().trim() || $('.tab-summary .author-content').text().trim();
    const description = $('.summary__content p').text().trim() || $('.description-summary p').text().trim();
    return { title, thumbnailUrl: this.absUrl(thumbnailUrl), author, description, lang: this.lang };
  }

  private _parseMangaList($: CheerioAPI): Manga[] {
    const mangas: Manga[] = [];
    $('.page-item-detail, .c-tabs-item__content, .row .item-thumb').each((_, el) => {
      const a = $(el).find('a[href]').first();
      const href = a.attr('href') ?? '';
      const title = a.attr('title') ?? a.text().trim();
      const thumb = $(el).find('img').first().attr('data-src') ?? $(el).find('img').first().attr('src') ?? '';
      if (title && href) mangas.push({ title, url: href, thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    return mangas;
  }

  private _hasNextPage(html: string): boolean {
    const $ = this.$(html);
    return $('.next, .nav-links a.next, a.next.page-numbers').length > 0;
  }

  private _parseDate(dateStr: string): number | undefined {
    if (!dateStr) return undefined;
    const trimmed = dateStr.trim();
    const months: Record<string, string> = {
      'janvier': '01', 'février': '02', 'fevrier': '02', 'mars': '03', 'avril': '04',
      'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08', 'aout': '08',
      'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12', 'decembre': '12',
      'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05', 'june': '06',
      'july': '07', 'august': '08', 'september': '09', 'october': '10', 'november': '11', 'december': '12',
    };
    const match = trimmed.match(/(\S+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (match) {
      const month = months[match[1].toLowerCase()] ?? '01';
      const day = match[2].padStart(2, '0');
      const ts = new Date(`${match[3]}-${month}-${day}`).getTime();
      return isNaN(ts) ? undefined : ts;
    }
    const match2 = trimmed.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
    if (match2) {
      const day = match2[1].padStart(2, '0');
      const month = months[match2[2].toLowerCase()] ?? '01';
      const ts = new Date(`${match2[3]}-${month}-${day}`).getTime();
      return isNaN(ts) ? undefined : ts;
    }
    const ts = Date.parse(trimmed);
    return isNaN(ts) ? undefined : ts;
  }
}
