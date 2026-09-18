import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio, CheerioAPI } from 'cheerio';

/**
 * Transcompilation of keiyoushi `all/hentaienvy` (GalleryAdults).
 * Updated 2026-09-18: upstream migrated to new hnv-gallery-* selectors,
 * totalPages/galleryId via data attributes, parsingImagePageByPage=true.
 */
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
    const q = encodeURIComponent(query.trim());
    // upstream basicSearchKey = "key" ; advanced-search path not needed for simple search
    const base = q ? `/search/?key=${q}` : '/search/';
    const url = this.buildPageUrl(base, page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  private buildPageUrl(base: string, page: number): string {
    if (page <= 1) return base;
    const sep = base.includes('?') ? '&' : base.endsWith('/') ? '' : '/';
    const connector = base.includes('?') ? '&' : base.includes('/') ? '' : '/';
    // GalleryAdults: addPageUri = trim('/').add "?page=X" or "/?page=X"
    const trimmed = base.replace(/\/$/, '');
    const join = base.includes('?') ? '&' : '/?';
    return `${trimmed}${join}page=${page}`;
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    // new selector: .hnv-gallery-card
    const mangas: Manga[] = $('.hnv-gallery-card').toArray().map(el => {
      const $el = $(el);
      const title = $el.find('.hnv-gallery-card__title').first().text().trim()
        || $el.find('a.hnv-gallery-card__cover img').attr('alt')?.trim()
        || '';
      const url = this.absUrl($el.find('a.hnv-gallery-card__cover').first().attr('href') || '');
      const thumbnailUrl = this.imgAttr($el.find('a.hnv-gallery-card__cover img').first());
      return { title, url, thumbnailUrl, lang: this.lang };
    }).filter(m => m.title && m.url);
    const hasNextPage = $('.pagination li.active + li:not(.disabled), a[rel="next"]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const container = $('.hnv-gallery-details');
    const title = container.find('h1').first().text().trim() || $('h1').first().text().trim();
    const thumbnailUrl = this.imgAttr($('.hnv-gallery-cover img').first());
    const genre = this.getInfo($, 'Tags');
    const author = this.getInfo($, 'Artists') || this.getInfo($, 'Groups');
    const desc = this.getDescription($);
    const pages = this.getInfo($, 'Pages');
    const fullDesc = pages ? (desc ? `${desc}\n\n**Pages**: ${pages}` : `**Pages**: ${pages}`) : desc;
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, author: author || undefined, description: fullDesc || undefined, genre: genre || undefined };
  }

  private getDescription($: CheerioAPI): string {
    const parts: string[] = [];
    for (const tag of ['Parodies', 'Characters', 'Groups', 'Languages', 'Categories', 'Category']) {
      const val = this.getInfo($, tag);
      if (val) parts.push(`**${tag}**: ${val}`);
    }
    // alternative title / full title handling simplified
    const altTitle = $('.hnv-gallery-details h1 + h2, .hnv-gallery-details .subtitle').first().text().trim();
    if (altTitle) parts.push(`**Alternative title**: ${altTitle}`);
    return parts.join('\n\n');
  }

  private getInfo($: CheerioAPI, tag: string): string {
    // new selector: div.hnv-gallery-entity-group:has(:contains(tag:)) a.hnv-gallery-tag
    // cheerio doesn't support :contains, use filter
    const groups = $('div.hnv-gallery-entity-group').toArray().filter(el => {
      const txt = $(el).find('.hnv-gallery-entity-label').text() || $(el).text();
      return txt.includes(tag);
    });
    const tags: string[] = [];
    for (const g of groups) {
      $(g).find('a.hnv-gallery-tag').each((_, el) => {
        const $el = $(el);
        const name = $el.find('.hnv-gallery-tag__name').first().text().trim() || $el.text().trim();
        const count = $el.find('.hnv-gallery-tag__count').text().trim().replace('| ', '');
        const full = [name, count].filter(s => s).join(', ');
        if (full) tags.push(full);
      });
    }
    // fallback to legacy selector for older pages if needed
    if (tags.length === 0) {
      return $(`ul:has(.tag_title:contains(${tag}:)) a.gp_tag`).toArray().map(el => {
        const $el = $(el);
        const name = $el.text().trim();
        const split = $el.find('.split_tag').text().trim().replace('| ', '');
        return [name, split].filter(s => s).join(', ');
      }).filter(s => s).join(', ');
    }
    return tags.join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    // Try new parsingImagePageByPage path: data-gallery-id + data-total-pages
    const galleryId = $('[data-gallery-id]').first().attr('data-gallery-id')
      || $('#js-thumbs-grid').attr('data-gallery-id')
      || '';
    const totalPagesStr = $('[data-total-pages]').first().attr('data-total-pages')
      || $('#js-thumbs-grid').attr('data-total-pages')
      || $('.hnv-gallery-pages .hnv-gallery-entity-items').first().text().trim()
      || '';

    const totalPages = parseInt(totalPagesStr, 10);

    if (galleryId && !isNaN(totalPages) && totalPages > 0) {
      // Try optimized path: fetch reader page 1 for JSON with ext list (single request)
      try {
        const readerUrl = `${this.baseUrl}/g/${galleryId}/1/`;
        const readerRes = await this.get(readerUrl);
        const $$ = this.$(readerRes.data);
        const jsonText = $$('#readerPagesJson').first().text().trim();
        if (jsonText) {
          const pagesData = JSON.parse(jsonText) as Array<{ page: number; ext: string }>;
          if (Array.isArray(pagesData) && pagesData.length === totalPages) {
            const base = $$('#readerApp').attr('data-reader-image-base')
              || `https://m11.hentaienvy.com/${$$('#js-thumbs-grid').attr('data-thumb-template') || ''}`;
            // base is https://m11.hentaienvy.com/033/k7nslbf45a
            const imageBase = $$('#readerApp').attr('data-reader-image-base') || '';
            if (imageBase) {
              return pagesData.map(p => ({
                index: p.page - 1,
                imageUrl: `${imageBase}/${p.page}.${p.ext}`,
              }));
            }
          }
        }
      } catch {
        // fallback to per-page fetch
      }

      // Fallback 1: thumb template -> construct via imageUrlParse per page (fetch each)
      // To avoid N fetches in generic path, fallback to thumbnail urls transformed
      // and also support incremental loading via thumbs_loader php (not needed for small galleries)
      const thumbs: string[] = $('#js-thumbs-grid img, .hnv-gallery-thumb img').toArray()
        .map(el => this.imgAttr($(el)))
        .filter(Boolean);

      if (thumbs.length > 0) {
        // Check if thumbs count == totalPages, we can convert t.jpg -> .ext via reader fetch for remaining
        // Simple: return thumb-based imageUrls (remove 't.' ) as fallback – may be .jpg but try webp fallback via per-page fetch for those missing
        const converted = thumbs.map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/i, '.$1'));
        if (converted.length >= totalPages) {
          return converted.slice(0, totalPages).map((imageUrl, idx) => ({ index: idx, imageUrl }));
        }
        // If thumbs < totalPages, try to fetch remaining via per-page imageUrlParse
        const pages: Page[] = converted.map((imageUrl, idx) => ({ index: idx, imageUrl }));
        // Fetch remaining pages one-by-one (limited)
        for (let i = converted.length + 1; i <= totalPages; i++) {
          try {
            const pRes = await this.get(`${this.baseUrl}/g/${galleryId}/${i}/`);
            const $$$ = this.$(pRes.data);
            const img = this.imgAttr($$$('img#readerImg, img#gimg, img#fimg').first());
            if (img) pages.push({ index: i - 1, imageUrl: img });
            else pages.push({ index: i - 1, imageUrl: '' });
          } catch {
            pages.push({ index: i - 1, imageUrl: '' });
          }
        }
        return pages.filter(p => p.imageUrl);
      }

      // Ultimate fallback: generate page URLs and fetch image per page
      const pages: Page[] = [];
      for (let i = 1; i <= totalPages; i++) {
        try {
          const pRes = await this.get(`${this.baseUrl}/g/${galleryId}/${i}/`);
          const $$$ = this.$(pRes.data);
          const imageUrl = this.imgAttr($$$('img#readerImg, img#gimg, img#fimg').first());
          if (imageUrl) pages.push({ index: i - 1, imageUrl });
        } catch {
          // skip
        }
      }
      if (pages.length > 0) return pages;
    }

    // Legacy fallback: old thumb selector .th_gp / .preview_thumb
    const legacy = $('.th_gp a img, .preview_thumb img, .hnv-gallery-thumb img').toArray()
      .map(el => this.imgAttr($(el)))
      .filter(Boolean)
      .map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/i, '.$1'));
    return legacy.map((imageUrl, idx) => ({ index: idx, imageUrl }));
  }

  private imgAttr($el: Cheerio<any>): string {
    if (!$el || !$el.length) return '';
    return this.absUrl(
      ($el.attr('data-cfsrc') as string) ||
      ($el.attr('data-src') as string) ||
      ($el.attr('data-lazy-src') as string) ||
      ($el.attr('src') as string) ||
      ''
    );
  }
}
