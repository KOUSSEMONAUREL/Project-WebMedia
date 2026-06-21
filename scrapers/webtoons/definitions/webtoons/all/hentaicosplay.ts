import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HentaiCosplayScraper extends BaseScraper {
  override readonly name = 'Hentai Cosplay';
  override readonly baseUrl = 'https://hentai-cosplay-xxx.com';
  override readonly lang = 'all';

  private dateCache = new Map<string, string>();

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const keyword = query.trim().replace(/ /g, '+');
    const res = await this.get(`${this.baseUrl}/search/keyword/${keyword}/page/${page}/`);
    return this.parseListing(res.data);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/ranking/page/${page}/`);
    return this.parseListing(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/search/page/${page}/`);
    return this.parseListing(res.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    if ($('div.image-list-item').length === 0) {
      return this.parseMobileListing($);
    }
    return this.parseDesktopListing($);
  }

  private parseMobileListing($: ReturnType<typeof this.$>): SearchResult {
    const mangas: Manga[] = $('#entry_list > li > a[href*=/image/]').toArray().map(el => {
      const $el = $(el);
      const url = this.absUrl($el.attr('href') || '');
      const title = $el.find('span:not(.posted)').first().text();
      const thumb = $el.find('img').first().attr('src') || '';
      const thumbnailUrl = this.absUrl(thumb).replace('http://', 'https://');
      const posted = $el.find('span.posted').first().text();
      if (posted) this.dateCache.set(url, posted);
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('a.paginator_page[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  private parseDesktopListing($: ReturnType<typeof this.$>): SearchResult {
    const mangas: Manga[] = $('div.image-list-item:has(a[href*=/image/])').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('a').first();
      const url = this.absUrl(a.attr('href') || '');
      const title = $el.find('.image-list-item-title').text();
      const thumb = $el.find('img').first().attr('src') || '';
      const thumbnailUrl = this.absUrl(thumb).replace('http://', 'https://');
      const dateText = $el.find('.image-list-item-regist-date').first().text();
      if (dateText) this.dateCache.set(url, dateText);
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('div.wp-pagenavi > a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const genre = $('#detail_tag a[href*=/tag/]').toArray().map(el => $(el).text()).join(', ');
    return { url: mangaUrl, lang: this.lang, genre: genre || undefined };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const chapterUrl = mangaUrl.replace('/image/', '/story/');
    const dateStr = this.dateCache.get(mangaUrl);
    let dateUpload: number | undefined;
    if (dateStr) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        dateUpload = new Date(+parts[0], +parts[1] - 1, +parts[2]).getTime();
      }
    }
    return [{ name: 'Gallery', url: chapterUrl, dateUpload }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('amp-img[src*=upload]:not(.related-thumbnail)').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}
