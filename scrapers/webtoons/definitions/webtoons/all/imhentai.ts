import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio } from 'cheerio';

export class IMHentaiScraper extends BaseScraper {
  readonly name = 'IMHentai';
  readonly baseUrl = 'https://imhentai.xxx';
  readonly lang = 'all';
  readonly supportsLatest = true;
  readonly useIntermediateSearch = true;
  readonly thumbnailSelector = '.gthumb';
  readonly pageUri = 'view';

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
    const sep = base.includes('?') ? '&' : '';
    return page > 1 ? `${base}${sep}page=${page}` : base;
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.galleries .gallery_title a, .thumb').toArray().map(el => {
      const $el = $(el);
      const url = this.absUrl($el.attr('href') || '');
      const img = $el.closest('.galleries, .thumb').find('img').first();
      const thumbnailUrl = this.imgAttr(img);
      const title = $el.text().trim() || img.attr('alt') || '';
      return { title, url, thumbnailUrl, lang: this.lang };
    }).filter(m => m.url);
    const hasNextPage = $('.pagination li.active + li:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const $info = $('.gallery_first').first();
    const title = $info.find('h1').first().text();
    const thumbnailUrl = this.imgAttr($('.left_cover img').first());
    const genre = this.getInfo($info, $, 'Tags');
    const author = this.getInfo($info, $, 'Artists');
    const desc = this.getDescription($info, $);
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, author, description: desc, genre };
  }

  private getDescription($info: Cheerio<any>, $: ReturnType<typeof this.$>): string {
    const parts: string[] = [];
    for (const tag of ['Parodies', 'Characters', 'Languages', 'Categories', 'Category']) {
      const val = this.getInfo($info, $, tag);
      if (val) parts.push(`${tag}: ${val}`);
    }
    return parts.join('\n\n');
  }

  private getInfo($info: Cheerio<any>, $: ReturnType<typeof this.$>, tag: string): string {
    return $info.find(`li:has(.tags_text:contains(${tag}:)) a.tag`).toArray().map(el => {
      const $el = $(el);
      const name = $el.text().trim();
      const split = $el.find('.split_tag').text().trim().replace('| ', '');
      return [name, split].filter(s => s).join(', ');
    }).filter(s => s).join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return [{
      name: 'Chapter',
      url: mangaUrl,
      scanlator: this.getInfo($('.gallery_first').first(), $, 'Groups') || undefined,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages = $('.gthumb a').toArray().map(el => {
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
