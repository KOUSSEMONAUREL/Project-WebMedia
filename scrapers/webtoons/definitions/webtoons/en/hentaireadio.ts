import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HentaiReadioScraper extends BaseScraper {
  readonly name = 'HentaiRead.io';
  readonly baseUrl = 'https://hentairead.io';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?act=search&f[status]=all&f[sortby]=top-manga&pageNum=${page}`);
    return this._parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?act=search&f[status]=all&f[sortby]=lastest-chap&pageNum=${page}`);
    return this._parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?act=search&f[keyword]=${encodeURIComponent(query)}&f[status]=all&f[sortby]=top-manga&pageNum=${page}`);
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('h1.title-detail').text().trim() || $('h1').text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.col-image img').first().attr('data-src') ?? $('.col-image img').first().attr('src') ?? ''),
      description: $('#summary_shortened').text().trim() || undefined,
      author: $('.author p.col-8').text().trim() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul#list_chapter_id_detail li.wp-manga-chapter, ul.version-chap li.wp-manga-chapter').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim();
      const dateText = $(el).find('.chapter-release-date i').text().trim();
      let dateUpload: number | undefined;
      if (dateText) {
        const ts = Date.parse(dateText);
        if (!isNaN(ts)) dateUpload = ts;
      }
      if (name && href) chapters.push({ name, url: href, dateUpload });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.page-chapter img').each((i, el) => {
      const src = $(el).attr('data-src') ?? $(el).attr('src') ?? '';
      if (src) pages.push({ index: i, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.card:has(.jtip)').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.title-manga a').text().trim();
      const url = $el.find('a').first().attr('href') ?? '';
      const thumb = $el.find('img.card-img-top').attr('data-src') ?? $el.find('img.card-img-top').attr('src') ?? '';
      if (title && url) mangas.push({ title, url: this.absUrl(url), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('ul.pagination li.page-item a.page-link:contains(»)').length > 0;
    return { mangas, hasNextPage };
  }
}
