import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class AsmHentaiScraper extends BaseScraper {
  readonly name = 'AsmHentai';
  readonly baseUrl = 'https://asmhentai.com';
  readonly lang = 'all';
  readonly favoritePath = 'inc/user.php?act=favs';
  readonly idPrefixUri = 'g';
  readonly pageUri = 'gallery';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl('/', page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl('/language/english/', page);
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
    const mangas: Manga[] = $('.preview_item').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('.image a').first();
      const url = this.absUrl(a.attr('href') || '');
      const img = $el.find('.image img').first();
      const thumbnailUrl = this.imgAttr(img);
      const title = img.attr('alt') || a.text() || '';
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('.pagination li.active + li:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const $info = $('.book_page').first();
    const title = $info.find('h1').first().text();
    const thumbnailUrl = this.imgAttr($('.cover img').first());
    const genre = this.getInfo($info, 'Tags');
    const author = this.getInfo($info, 'Artists');
    const desc = this.getDescription($info, $);
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, author, description: desc, genre };
  }

  private getDescription($info: cheerio.Cheerio, $: ReturnType<typeof this.$>): string {
    const parts: string[] = [];
    for (const tag of ['Parodies', 'Characters', 'Languages', 'Categories', 'Category']) {
      const val = this.getInfo($info, tag);
      if (val) parts.push(`${tag}: ${val}`);
    }
    const pagesEl = $info.find('.book_page .pages h3').first().text();
    if (pagesEl) parts.push(`Pages: ${pagesEl}`);
    const altTitle = $info.find('h1 + h2, .subtitle').first().text();
    if (altTitle) parts.push(`Alternative title: ${altTitle}`);
    return parts.join('\n\n');
  }

  private getInfo($info: cheerio.Cheerio, tag: string): string {
    return $info.find(`.tags:contains(${tag}:) .tag_list a`).toArray().map(el => {
      const $el = $(el);
      const name = $el.find('.tag').first().text().trim();
      const split = $el.find('.split_tag').text().replace('| ', '').trim();
      return [name, split].filter(s => s).join(', ');
    }).filter(s => s).join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return [{
      name: 'Chapter',
      url: mangaUrl,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const totalPages = this.inputIdValue($, 't_pages');
    const pages = $('.preview_thumb a').toArray().map(el => {
      const $el = $(el);
      return this.imgAttr($el.find('img').first()) || '';
    }).filter(s => s).map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/, '.$1'));
    if (totalPages && parseInt(totalPages) > pages.length) {
      const token = $('[name=csrf-token]').attr('content') || '';
      const form = new URLSearchParams();
      form.append('id', this.inputIdValue($, 'load_id'));
      form.append('dir', this.inputIdValue($, 'load_dir'));
      form.append('visible_pages', pages.length.toString());
      form.append('t_pages', totalPages);
      form.append('type', '2');
      if (token) form.append('_token', token);
      const moreRes = await this.post('/inc/thumbs_loader.php', form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      });
      const $$ = this.$(moreRes.data);
      const morePages = $$('a').toArray().map(el => {
        const $el = $$(el);
        return this.imgAttr($el.find('img').first()) || '';
      }).filter(s => s).map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/, '.$1'));
      pages.push(...morePages);
    }
    return pages.map((url, idx) => ({ index: idx, imageUrl: url }));
  }

  private inputIdValue($: ReturnType<typeof this.$>, id: string): string {
    return $(`input[id="${id}"]`).attr('value') || '';
  }

  private imgAttr($el: cheerio.Cheerio): string {
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
