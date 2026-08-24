import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio } from 'cheerio';

export class HentaiFoxScraper extends BaseScraper {
  readonly name = 'HentaiFox';
  readonly baseUrl = 'https://hentaifox.com';
  readonly lang = 'all';
  readonly supportsLatest = true;
  readonly favoritePath = 'includes/user_favs.php';
  readonly pagesRequest = 'includes/thumbs_loader.php';

  private csrfToken: string | null = null;
  // thumbs_loader.php requires the PHP session cookies issued with the gallery page
  private cookies = new Map<string, string>();

  private storeCookies(headers: unknown): void {
    const raw = (headers as { 'set-cookie'?: string[] | string })['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const c of list) {
      const pair = c.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

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
    const q = query.trim().replace(/[^a-zA-Z0-9"]+(?=[a-zA-Z0-9"])/g, '+');
    const url = this.buildPageUrl(`/search/${encodeURIComponent(q)}/`, page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  private buildPageUrl(base: string, page: number): string {
    if (page <= 1) return base;
    // Upstream quirk: root listing uses /page/2/ once then /pag/N/
    if (base === '/') return page === 2 ? '/page/2/' : `/pag/${page}/`;
    if (base.includes('?')) return `${base}&page=${page}`;
    return `${base.replace(/\/$/, '')}/pag/${page}/`;
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    // Upstream GalleryAdults: url/thumbnail from `.inner_thumb`, title from `.caption`
    const mangas: Manga[] = $('.galleries_box .gallery_item, .thumb').toArray().map(el => {
      const $el = $(el);
      const innerA = $el.find('.inner_thumb a').first();
      const a = innerA.length > 0 ? innerA : $el.find('a[href*="/gallery/"]').first();
      const url = this.absUrl(a.attr('href') || '');
      const img = $el.find('.inner_thumb img').first();
      const thumbnailUrl = this.imgAttr(img);
      const title = $el.find('.caption').first().text().trim() || img.attr('alt') || '';
      return { title, url, thumbnailUrl, lang: this.lang };
    }).filter(m => m.url && m.title);
    const hasNextPage = $('.pagination li.active + li:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1').first().text();
    const thumbnailUrl = this.imgAttr($('.cover img').first());
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
    const posted = $('.pages:contains(Posted:)').first().text().replace('Posted: ', '').trim();
    if (posted) parts.push(`Posted: ${posted}`);
    return parts.join('\n\n');
  }

  private getInfo($: ReturnType<typeof this.$>, tag: string): string {
    return $(`ul.${tag.toLowerCase()} a`).toArray().map(el => {
      const $el = $(el);
      const name = $el.text().trim();
      const split = $el.find('.split_tag').text().replace('| ', '').trim();
      return [name, split].filter(s => s).join(', ');
    }).filter(s => s).join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    this.storeCookies(res.headers);
    const $ = this.$(res.data);
    this.csrfToken = $('[name=csrf-token]').attr('content') || null;
    const totalPages = this.inputIdValue($, 'load_pages');
    const galleryId = this.inputIdValue($, 'gallery_id');
    const pageUrl = `${this.baseUrl}/g/${galleryId}`;
    const pages = $('.gallery_thumb a, .preview_thumb a').toArray().map(el => {
      const $el = $(el);
      return this.imgAttr($el.find('img').first()) || '';
    }).filter(s => s).map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/, '.$1'));
    if (totalPages && parseInt(totalPages) > pages.length) {
      const token = $('[name=csrf-token]').attr('content') || '';
      const form = new URLSearchParams();
      form.append('u_id', this.inputIdValue($, 'gallery_id'));
      form.append('g_id', this.inputIdValue($, 'load_id'));
      form.append('img_dir', this.inputIdValue($, 'load_dir'));
      form.append('visible_pages', pages.length.toString());
      form.append('total_pages', totalPages);
      form.append('type', '2');
      if (token) form.append('_token', token);
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (this.csrfToken) {
        headers['X-Csrf-Token'] = this.csrfToken;
        headers['Referer'] = `${this.baseUrl}/`;
      }
      const cookie = this.cookieHeader();
      if (cookie) headers['Cookie'] = cookie;
      const moreRes = await this.post(`/${this.pagesRequest}`, form.toString(), { headers });
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
