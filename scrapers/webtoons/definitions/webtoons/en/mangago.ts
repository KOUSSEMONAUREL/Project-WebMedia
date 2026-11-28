import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

export class MangagoScraper extends BaseScraper {
  readonly name = 'Mangago';
  readonly baseUrl = 'https://www.mangago.me';
  readonly lang = 'en';

  private imageFromElement($: CheerioAPI, el: ReturnType<CheerioAPI>): string {
    const dataSrc = (el.attr('data-src') || '').trim();
    if (dataSrc) return this.absUrl(dataSrc);
    const src = (el.attr('src') || '').trim();
    return src ? this.absUrl(src) : '';
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.updatesli, .pic_list > li').toArray()
      .map(el => {
        const $el = $(el);
        const link = $el.find('.thm-effect').first();
        const title = (link.attr('title') || '').trim();
        const href = link.attr('href') || '';
        if (!title || !href) return null;
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.imageFromElement($, link.find('img').first()),
          lang: this.lang,
        };
      })
      .filter((m): m is Manga => m !== null);
    return { mangas, hasNextPage: $('.current + li > a').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/genre/all/${page}/?f=1&o=1&sortby=view&e=`);
    return this.parseListing(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/list/latest/all/${page}/`);
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const q = query.trim();
    if (!q) return this.getPopular(page);
    const res = await this.get(`${this.baseUrl}/r/l_search?name=${encodeURIComponent(q)}&page=${page}`);
    return this.parseListing(res.data);
  }

  private statusOf(text: string): MangaStatus {
    const value = text.toLowerCase();
    if (value.includes('ongoing')) return 1;
    if (value.includes('completed')) return 0;
    return 3;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    let author: string | undefined;
    let genre: string | undefined;
    let status: MangaStatus;
    $('.manga_info li, .manga_right tr').each((_, el) => {
      const $el = $(el);
      const label = $el.find('b, label').first().text().trim().toLowerCase();
      if (label.startsWith('author')) {
        author = $el.find('a').toArray().map(a => $(a).text().trim()).filter(Boolean).join(', ') || undefined;
      } else if (label.startsWith('genre')) {
        genre = $el.find('a').toArray().map(a => $(a).text().trim()).filter(Boolean).join(', ') || undefined;
      } else if (label.startsWith('status')) {
        status = this.statusOf($el.find('span').first().text());
      }
    });
    return {
      title: $('.w-title h1').first().text().trim() || $('title').text().trim(),
      url: this.absUrl(mangaUrl),
      thumbnailUrl: this.imageFromElement($, $('#information img').first()),
      description: $('.manga_summary').first().text().trim() || undefined,
      author,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    return $(':is(table#raws_table, table#chapter_table) > tbody > tr, table.uk-table > tbody > tr').toArray()
      .map(row => {
        const link = $(row).find('a.chico').first();
        const href = link.attr('href') || '';
        const name = link.text().trim();
        if (!href || !name) return null;
        const absolute = new URL(href, this.baseUrl);
        return {
          name,
          url: absolute.host.endsWith('mangago.me') ? absolute.pathname + absolute.search : absolute.href,
        };
      })
      .filter((ch): ch is Chapter => ch !== null);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    return $('img').toArray()
      .map(el => this.imageFromElement($, $(el)))
      .filter(url => url && !url.includes('mangapicgallery.com/images/'))
      .map((imageUrl, index) => ({ index, imageUrl }));
  }
}
