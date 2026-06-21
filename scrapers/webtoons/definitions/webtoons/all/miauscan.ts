import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const PORTUGUESE_GENRE_ID = '307';
const PORTUGUESE_SUFFIX = /^\(\s*Portugu[êe]s\s*\)\s*/i;

export class MiauScanScraper extends BaseScraper {
  readonly name = 'Miau Scan';
  readonly baseUrl = 'https://leemiau.com';
  readonly lang: string;

  constructor(lang = 'es') {
    super();
    this.lang = lang;
  }

  private get portugueseGenreParam(): string {
    return this.lang === 'pt-BR' ? PORTUGUESE_GENRE_ID : `-${PORTUGUESE_GENRE_ID}`;
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/manga`);
    url.searchParams.set('title', query);
    url.searchParams.set('page', String(page));
    url.searchParams.append('genre[]', this.portugueseGenreParam);
    const res = await this.get(url.toString());
    return this._parseSearchResult(res.data);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/manga`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('order', 'popular');
    url.searchParams.append('genre[]', this.portugueseGenreParam);
    const res = await this.get(url.toString());
    return this._parseSearchResult(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/manga`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('order', 'update');
    url.searchParams.append('genre[]', this.portugueseGenreParam);
    const res = await this.get(url.toString());
    return this._parseSearchResult(res.data);
  }

  private _parseSearchResult(html: string): SearchResult {
    const $ = this.$(html);
    const selector = '.utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx';
    const mangas: Manga[] = $(selector).toArray().map(el => this._mangaFromElement($(el)));
    const hasNextPage = $('div.pagination .next, div.hpage .r').length > 0;
    return { mangas, hasNextPage };
  }

  private _mangaFromElement($el: any): Manga {
    const link = $el.find('a').first();
    const title = (link.attr('title') || '').replace(PORTUGUESE_SUFFIX, '');
    const url = this.absUrl(link.attr('href') || '');
    const thumbnailUrl = this._imgAttr($el.find('img').first()) || '';
    return { title, url, thumbnailUrl, lang: this.lang };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const detailEl = $('div.bigcontent, div.animefull, div.main-info, div.postbody').first();
    const title = (detailEl.find('h1.entry-title, .ts-breadcrumb li:last-child span').first().text() || '').replace(PORTUGUESE_SUFFIX, '');
    const description = detailEl.find('.lm4-summary-full').first().text() || detailEl.find('.lm4-summary-short').first().text() || undefined;
    const thumbnailUrl = this._imgAttr(detailEl.find('.infomanga > div[itemprop=image] img, .thumb img').first()) || '';
    const author = detailEl.find('.infotable tr:contains(Artist) td:last-child, .tsinfo .imptdt:contains(Artist) i, .fmed b:contains(Artist)+span').first().text() || undefined;
    return {
      title: title || $('h1.entry-title').first().text(),
      url: mangaUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      description,
      author,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('a').first();
      const url = this.absUrl(link.attr('href') || '');
      const chTitle = $el.find('.lm4-chapter-name').text();
      const chSubtitle = $el.find('.lm4-chapter-subtitle').text();
      let name = chTitle;
      if (chSubtitle && chSubtitle !== chTitle) name = `${chTitle} - ${chSubtitle}`;
      const dateText = $el.find('.lm4-chapter-date').first().text();
      const dateUpload = dateText ? this._parseDate(dateText) : undefined;
      return { name, url, dateUpload };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('div#readerarea img').toArray().forEach(el => {
      const imageUrl = this._imgAttr($(el));
      if (imageUrl) pages.push({ index: pages.length, imageUrl });
    });
    return pages;
  }

  private _imgAttr($el: any): string {
    if ($el.attr('data-lm-orig-src')) return this.absUrl($el.attr('data-lm-orig-src'));
    if ($el.attr('data-lazy-src')) return this.absUrl($el.attr('data-lazy-src'));
    if ($el.attr('data-src')) return this.absUrl($el.attr('data-src'));
    if ($el.attr('data-cfsrc')) return this.absUrl($el.attr('data-cfsrc'));
    const src = $el.attr('src');
    return src ? this.absUrl(src) : '';
  }

  private _parseDate(dateStr: string): number {
    const parts = dateStr.trim().split('/');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    return 0;
  }
}
