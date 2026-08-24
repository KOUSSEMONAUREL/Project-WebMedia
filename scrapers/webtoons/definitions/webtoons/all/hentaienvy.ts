import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio } from 'cheerio';

export class HentaiEnvyScraper extends BaseScraper {
  readonly name = 'HentaiEnvy';
  readonly baseUrl = 'https://hentaienvy.com';
  readonly lang = 'all';
  readonly favoritePath = 'inc/user.php?act=favs';
  readonly supportsLatest = true;

  async getPopular(page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl('/', page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl('/', page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl(`/search/${encodeURIComponent(query)}/`, page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  private buildPageUrl(base: string, page: number): string {
    return page > 1 ? `${base}page/${page}/` : base;
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('a:has(.th_img)').toArray().map(el => {
      const $el = $(el);
      const url = this.absUrl($el.attr('href') || '');
      const img = $el.find('img').first();
      const thumbnailUrl = this.imgAttr(img);
      const title = img.attr('alt') || $el.find('.title').first().text() || '';
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('.pagination li.active + li:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1').first().text();
    const thumbnailUrl = this.imgAttr($('.gt_left img').first());
    const genre = this.getInfo($, 'Tags');
    const author = this.getInfo($, 'Artists') || this.getInfo($, 'Groups');
    const desc = this.getDescription($);
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, author, description: desc, genre };
  }

  private getDescription($: ReturnType<typeof this.$>): string {
    const parts: string[] = [];
    for (const tag of ['Parodies', 'Characters', 'Groups', 'Languages', 'Categories', 'Category']) {
      const val = this.getInfo($, tag);
      if (val) parts.push(`${tag}: ${val}`);
    }
    return parts.join('\n\n');
  }

  private getInfo($: ReturnType<typeof this.$>, tag: string): string {
    return $(`ul:has(.tag_title:contains(${tag}:)) a.gp_tag`).toArray().map(el => {
      const $el = $(el);
      const name = $el.text().trim();
      const split = $el.find('.split_tag').text().trim().replace('| ', '');
      return [name, split].filter(s => s).join(', ');
    }).filter(s => s).join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages = $('.th_gp a').toArray().map(el => {
      const $el = $(el);
      return this.imgAttr($el.find('img').first()) || '';
    }).filter(s => s).map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/, '.$1'));
    return pages.map((url, idx) => ({ index: idx, imageUrl: url }));
  }

  private imgAttr($el: Cheerio<any>): string {
    if (!$el || !$el.length) return '';
    return this.absUrl(
      $el.attr('data-cfsrc') ||
      $el.attr('data-src') ||
      $el.attr('data-lazy-src') ||
      $el.attr('src') ||
      ''
    );
  }
}
