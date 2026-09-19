import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio, CheerioAPI } from 'cheerio';

/**
 * Transcompilation of keiyoushi `all/asmhentai` (GalleryAdults).
 */
export class AsmHentaiScraper extends BaseScraper {
  readonly name = 'AsmHentai';
  readonly baseUrl = 'https://asmhentai.com';
  readonly lang = 'all';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const url = page > 1 ? `${this.baseUrl}/page/${page}/` : `${this.baseUrl}/`;
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const q = encodeURIComponent(query.trim());
    const base = q ? `${this.baseUrl}/search/${q}/` : `${this.baseUrl}/`;
    const url = page > 1 ? `${base}page/${page}/` : base;
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.preview_item').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('.image a').first();
      const url = this.absUrl(a.attr('href') || $el.find('a').first().attr('href') || '');
      const img = $el.find('.image img').first();
      const title = img.attr('alt')?.trim() || $el.find('.preview_item_title, h3').first().text().trim() || a.attr('href') || '';
      const thumbnailUrl = this.imgAttr(img);
      return { title: title.trim(), url, thumbnailUrl, lang: this.lang };
    }).filter(m => m.url);
    const hasNextPage = $('.pagination li.active + li:not(.disabled), a[rel="next"]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.book_page h1, h1').first().text().trim();
    const thumbnailUrl = this.imgAttr($('.book_page img, .gt_left img').first());
    const genre = this.getInfo($, 'Tags');
    const author = this.getInfo($, 'Artists') || this.getInfo($, 'Groups');
    const descParts: string[] = [];
    const pages = $('.book_page .pages h3').first().text().trim().split(':').pop()?.trim();
    if (pages) descParts.push(`**Pages**: ${pages}`);
    const alt = $('.book_page h1 + h2, .subtitle').first().text().trim();
    if (alt) descParts.push(`**Alternative title**: ${alt}`);
    for (const tag of ['Parodies', 'Characters', 'Groups', 'Languages', 'Categories']) {
      const v = this.getInfo($, tag);
      if (v) descParts.push(`**${tag}**: ${v}`);
    }
    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      lang: this.lang,
      author: author || undefined,
      genre: genre || undefined,
      description: descParts.join('\n\n') || undefined,
    };
  }

  private getInfo($: CheerioAPI, tag: string): string {
    // .tags:contains(tag:) .tag_list a  with .tag name
    const container = $(`.tags:contains(${tag}:)`).first();
    if (container.length > 0) {
      return container.find('.tag_list a').toArray().map(el => {
        const $el = $(el);
        return $el.find('.tag').first().text().trim() || $el.text().trim();
      }).filter(Boolean).join(', ');
    }
    // fallback hnv style
    return $(`div.hnv-gallery-entity-group:contains(${tag}) a`).toArray().map(el => $(el).text().trim()).filter(Boolean).join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    // Primary: .preview_thumb img
    let thumbs = $('.preview_thumb img').toArray().map(el => this.imgAttr($(el))).filter(Boolean);
    if (thumbs.length > 0) {
      // Check total pages via input#t_pages or load_pages or book_page pages count
      const tPages = $('input#t_pages').attr('value') || $('input#load_pages').attr('value') || '';
      const total = parseInt(tPages, 10);
      if (!isNaN(total) && total > thumbs.length) {
        // Need to fetch remaining via thumbs_loader php (form)
        const loadId = $('input#load_id').attr('value') || $('input#gallery_id').attr('value') || '';
        const loadDir = $('input#load_dir').attr('value') || '';
        if (loadId && loadDir) {
          try {
            const token = $('[name=csrf-token]').attr('content') || '';
            const params = new URLSearchParams();
            params.set('id', loadId);
            params.set('dir', loadDir);
            params.set('visible_pages', String(thumbs.length));
            params.set('t_pages', String(total));
            params.set('type', '2');
            if (token) params.set('_token', token);
            const ajax = await this.post(`${this.baseUrl}/inc/thumbs_loader.php`, params.toString(), {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                Referer: chapterUrl,
              },
            });
            const $$ = this.$(ajax.data as string);
            const more = $$('a img').toArray().map(el => this.imgAttr($$(el))).filter(Boolean);
            if (more.length > 0) thumbs = thumbs.concat(more);
          } catch {
            // ignore
          }
        }
      }
      return thumbs.map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/i, '.$1'))
        .map((imageUrl, idx) => ({ index: idx, imageUrl }));
    }
    // Fallback generic thumb
    const generic = $('img[src*="thumb"], .thumb img').toArray().map(el => this.imgAttr($(el))).filter(Boolean);
    return generic.map((imageUrl, idx) => ({ index: idx, imageUrl: imageUrl.replace(/t\.(jpg|jpeg|png).*$/i, '.$1') }));
  }

  private imgAttr($el: Cheerio<any>): string {
    if (!$el || !$el.length) return '';
    return this.absUrl(
      ($el.attr('data-cfsrc') as string) ||
      ($el.attr('data-src') as string) ||
      ($el.attr('data-lazy-src') as string) ||
      ($el.attr('data-srcset') as string)?.split(' ')[0] ||
      ($el.attr('src') as string) ||
      ''
    );
  }
}
