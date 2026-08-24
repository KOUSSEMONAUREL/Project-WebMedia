import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio, CheerioAPI } from 'cheerio';

/**
 * Transcompilation of keiyoushi `all/nhentaito` (GalleryAdults multi-src).
 * Popular  : /search?q=*&sort=most-favorited&page=N
 * Latest   : /search?q=*&sort=newest&page=N
 * Search   : /search?q=<query|*>&lang=<lang>
 * Details  : /g/<id>/  (#bigcontainer, #cover img, .field-name tags)
 * Chapters : single virtual chapter pointing at the gallery page
 * Pages    : #thumbnail-container .thumb-container a img -> thumbnailToFull()
 */
export class NHentaiToScraper extends BaseScraper {
  readonly name = 'NHentaiTo';
  readonly baseUrl = 'https://nhentai.to';
  readonly lang = 'all';

  /** GalleryAdults `mangaLang` — blank (LANGUAGE_MULTI) for this source. */
  private readonly mangaLang = '';

  private buildSearchUrl(query: string, sort: string | null, page: number): string {
    const params = new URLSearchParams();
    params.set('q', query || '*');
    if (sort) params.set('sort', sort);
    if (this.mangaLang) params.set('lang', this.mangaLang);
    return `${this.baseUrl}/search?${params.toString()}&page=${page}`;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.buildSearchUrl('', 'most-favorited', page));
    return this.parseListing(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.buildSearchUrl('', 'newest', page));
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(this.buildSearchUrl(query.trim(), null, page));
    return this.parseListing(res.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.gallery a:not([rel~=sponsored])').toArray().map(el => {
      const $el = $(el);
      return {
        title: $el.find('.caption').text().trim(),
        url: this.absUrl($el.attr('href') || ''),
        thumbnailUrl: this.withFallback($el.find('img').first()),
        lang: this.lang,
      };
    }).filter(m => m.title && m.url);
    return { mangas, hasNextPage: $('a.next').length > 0 };
  }

  /** Upstream `withFallback()`: primary image + "#fallback<data-fallbacks>" fragment marker. */
  private withFallback($img: Cheerio<any>): string {
    const image = this.imgAttr($img);
    if (!image) return '';
    const fallbacks = $img.attr('data-fallbacks') || '';
    return fallbacks ? `${image}#fallback${fallbacks}` : image;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const info = $('#info');

    const title = $('h1', info).first().text().trim();
    const altTitle = $('h2', info).first().text().trim();

    const descriptionParts: string[] = [];
    for (const tag of ['Parodies', 'Characters', 'Groups', 'Languages', 'Categories', 'Category']) {
      const val = this.getInfo($, tag);
      if (val) descriptionParts.push(`**${tag}**: ${val}`);
    }
    const pagesCount = this.getInfo($, 'Pages');
    if (pagesCount) descriptionParts.push(`**Pages**: ${pagesCount}`);
    if (altTitle) descriptionParts.push(`**Alternative title**: ${altTitle}`);

    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.withFallback($('#cover img').first()),
      lang: this.lang,
      author: this.getInfo($, 'Artists') || this.getInfo($, 'Groups') || undefined,
      genre: this.getInfo($, 'Tags') || undefined,
      description: descriptionParts.join('\n\n') || undefined,
    };
  }

  /** Upstream getInfoSelector: `#info-block .field-name:contains($tag) .tags a`, name from `.name`. */
  private getInfo($: CheerioAPI, tag: string): string {
    return $(`#info-block .field-name:contains(${tag}) .tags a`).toArray().map(el => {
      const $el = $(el);
      return [$('.name', $el).text().trim(), $('.split_tag', $el).text().replace('| ', '').trim()]
        .filter(s => s)
        .join(', ');
    }).filter(s => s).join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return [{
      name: 'Chapter',
      url: mangaUrl,
      scanlator: this.getInfo($, 'Groups') || undefined,
      dateUpload: this.getUploadTime($) || undefined,
    }];
  }

  private getUploadTime($: CheerioAPI): number {
    const datetime = $('.tags time').first().attr('datetime');
    if (!datetime) return 0;
    const t = Date.parse(datetime);
    return Number.isNaN(t) ? 0 : t;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('#thumbnail-container .thumb-container a img').toArray().map((el, index) => ({
      index,
      imageUrl: this.thumbnailToFull(this.imgAttr($(el))),
    })).filter(p => p.imageUrl);
  }

  /** Upstream `thumbnailToFull()`: "1t.webp" -> "1.webp". */
  private thumbnailToFull(url: string): string {
    const ext = url.substring(url.lastIndexOf('.') + 1);
    return ext ? url.replace(`t.${ext}`, `.${ext}`) : url;
  }

  private imgAttr($el: Cheerio<any>): string {
    if (!$el || !$el.length) return '';
    return this.absUrl(
      $el.attr('data-src') ||
      $el.attr('data-lazy-src') ||
      $el.attr('data-cfsrc') ||
      $el.attr('src') ||
      ''
    );
  }
}
