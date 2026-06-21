import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HentaiscanreaderScraper extends BaseScraper {
  readonly name = 'HentaiScanReader';
  readonly baseUrl = 'https://hentai.scanreader.net';
  readonly lang = 'fr';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get('/', { params: { page: String(page) } });
    return { mangas: this._parseMangaList(this.$(res.data)), hasNextPage: this._hasNextPage(res.data) };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get('/', { params: { s: query, page: String(page) } });
    return { mangas: this._parseMangaList(this.$(res.data)), hasNextPage: this._hasNextPage(res.data) };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul.chapter-list li, .wp-manga-chapter, .chapters li, .chapter-item').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim() || $(el).find('.chapternum').text().trim() || $(el).contents().first().text().trim();
      const dateText = $(el).find('span.date, .chapter-date, .updated').text().trim();
      chapters.push({ name, url: href, dateUpload: this._parseDate(dateText) });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.reading-content img, .reader-area img, #readerarea img, .rdminimal img, .chapter-content img').each((i, el) => {
      const src = $(el).attr('data-src') ?? $(el).attr('src') ?? $(el).attr('data-lazy-src') ?? '';
      if (src) pages.push({ imageUrl: this.absUrl(src), index: i });
    });
    if (pages.length === 0) {
      $('script').each((_, s) => {
        const text = $(s).html() ?? '';
        const match = text.match(/var\s+(?:chapterImages|images|ts_reader_images)\s*=\s*(\[[\s\S]*?\])\s*;/);
        if (match) {
          try {
            const images = JSON.parse(match[1]);
            images.forEach((src: string, i: number) => {
              if (src) pages.push({ imageUrl: this.absUrl(src), index: i });
            });
          } catch (err) {
            console.error(`Failed to parse chapter images JSON on ${this.name}: ${err instanceof Error ? err.message : err}`);
          }
        }
      });
    }
    return pages;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.post-title h1, h1.entry-title, .entry-title').first().text().trim();
    const thumbnailUrl = $('.summary_image img, .thumb img').first().attr('data-src') ?? $('.summary_image img, .thumb img').first().attr('src') ?? '';
    const author = $('.author-content a, .autor a').text().trim();
    const description = $('.summary__content p, .entry-content p, .description p').first().text().trim();
    return { title, thumbnailUrl: this.absUrl(thumbnailUrl), author, description, lang: this.lang };
  }

  private _parseMangaList($: cheerio.CheerioAPI): Manga[] {
    const mangas: Manga[] = [];
    $('.page-item-detail, .bs div.bsx, .listupd article, .c-tabs-item__content, .row .item-thumb').each((_, el) => {
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
    return $('.next, .nav-links a.next, a.next.page-numbers, .pagination .next').length > 0;
  }

  private _parseDate(dateStr: string): number | undefined {
    if (!dateStr) return undefined;
    const ts = Date.parse(dateStr.trim());
    return isNaN(ts) ? undefined : ts;
  }
}
