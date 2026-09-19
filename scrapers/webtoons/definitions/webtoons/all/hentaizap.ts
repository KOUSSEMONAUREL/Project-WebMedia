import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio, CheerioAPI } from 'cheerio';

/**
 * Transcompilation of keiyoushi `all/hentaizap` (GalleryAdults).
 * Updated selectors: .hz-gallery-card, data-gallery-id / data-total-pages, parsingImagePageByPage.
 */
export class HentaizapScraper extends BaseScraper {
  readonly name = 'HentaiZap';
  readonly baseUrl = 'https://hentaizap.com';
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
    const base = q ? `${this.baseUrl}/search/?key=${q}` : `${this.baseUrl}/search/`;
    const url = page > 1 ? `${base}${base.includes('?') ? '&' : '/?'}page=${page}` : base;
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.hz-gallery-card').toArray().map(el => {
      const $el = $(el);
      const title = $el.find('.hz-gallery-card__title a').first().text().trim()
        || $el.find('.hz-gallery-card__title').first().text().trim()
        || $el.find('a.hz-gallery-card__cover img').attr('alt')?.trim()
        || '';
      const url = this.absUrl($el.find('a.hz-gallery-card__cover').first().attr('href') || '');
      const thumbnailUrl = this.imgAttr($el.find('.hz-gallery-card__media.thumb img, a.hz-gallery-card__cover img').first());
      return { title: title.trim(), url, thumbnailUrl, lang: this.lang };
    }).filter(m => m.title && m.url);
    const hasNextPage = $('.pagination li.active + li:not(.disabled), a[rel="next"]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.hz-gallery-details h1, h1').first().text().trim();
    const thumbnailUrl = this.imgAttr($('.hz-gallery-cover img').first());
    const genre = this.getInfo($, 'Tags');
    const author = this.getInfo($, 'Artists') || this.getInfo($, 'Groups');
    const parts: string[] = [];
    for (const tag of ['Parodies', 'Characters', 'Groups', 'Languages', 'Categories']) {
      const v = this.getInfo($, tag);
      if (v) parts.push(`**${tag}**: ${v}`);
    }
    const pages = $('[data-total-pages]').first().attr('data-total-pages')
      || $('.hz-gallery-pages').first().text().trim().split(':').pop()?.trim()
      || '';
    if (pages && !isNaN(parseInt(pages, 10))) {
      parts.push(`**Pages**: ${pages.trim()}`);
    }
    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      lang: this.lang,
      author: author || undefined,
      genre: genre || undefined,
      description: parts.join('\n\n') || undefined,
    };
  }

  private getInfo($: CheerioAPI, tag: string): string {
    const groups = $('div.hz-gallery-entity-group').toArray().filter(el => {
      const label = $(el).find('.hz-gallery-entity-label, span').first().text();
      const txt = $(el).text();
      return label.includes(tag) || txt.includes(`${tag}:`);
    });
    const out: string[] = [];
    for (const g of groups) {
      $(g).find('a.hz-gallery-tag').each((_, el) => {
        const $el = $(el);
        const name = $el.find('.hz-gallery-tag__name').first().text().trim() || $el.text().trim();
        if (name) out.push(name);
      });
    }
    if (out.length === 0) {
      // fallback
      return $(`div.hz-gallery-entity-group:has(:contains(${tag})) a.hz-gallery-tag`).toArray()
        .map(el => $(el).text().trim()).filter(Boolean).join(', ');
    }
    return out.join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const galleryId = $('[data-gallery-id]').first().attr('data-gallery-id') || '';
    const totalPagesStr = $('[data-total-pages]').first().attr('data-total-pages') || '';
    const totalPages = parseInt(totalPagesStr, 10);

    if (galleryId && !isNaN(totalPages) && totalPages > 0) {
      // Try reader JSON optimization (similar to HentaiEnvy but HentaiZap may not have JSON – try per-page readerImg)
      // Check if page contains readerPagesJson or similar; if not, fetch reader page 1
      try {
        const firstReader = `${this.baseUrl}/g/${galleryId}/1/`;
        const r = await this.get(firstReader);
        const $$ = this.$(r.data);
        // HentaiZap reader uses #readerImg as well (check upstream)
        const json = $$('#readerPagesJson').first().text().trim();
        if (json) {
          const data = JSON.parse(json) as Array<{ page: number; ext: string }>;
          const base = $$('#readerApp').attr('data-reader-image-base');
          if (base && Array.isArray(data) && data.length === totalPages) {
            return data.map(p => ({ index: p.page - 1, imageUrl: `${base}/${p.page}.${p.ext}` }));
          }
        }
        // fallback per-page fetch via img#readerImg
        const imageUrl = this.imgAttr($$('img#readerImg, img#gimg, img#fimg').first());
        if (imageUrl) {
          const pages: Page[] = [{ index: 0, imageUrl }];
          for (let i = 2; i <= totalPages; i++) {
            try {
              const pr = await this.get(`${this.baseUrl}/g/${galleryId}/${i}/`);
              const $$$ = this.$(pr.data);
              const img = this.imgAttr($$$('img#readerImg, img#gimg, img#fimg').first());
              pages.push({ index: i - 1, imageUrl: img || '' });
            } catch {
              pages.push({ index: i - 1, imageUrl: '' });
            }
          }
          return pages.filter(p => p.imageUrl);
        }
      } catch {
        // fallback to thumb grid
      }

      // Thumb fallback
      const thumbs = $('[data-total-pages] img, .hz-gallery-thumb img, .thumb img').toArray()
        .map(el => this.imgAttr($(el))).filter(Boolean);
      if (thumbs.length > 0) {
        const converted = thumbs.map(u => u.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/i, '.$1'));
        if (converted.length >= totalPages) {
          return converted.slice(0, totalPages).map((imageUrl, idx) => ({ index: idx, imageUrl }));
        }
      }
      // Generate urls and fetch one-by-one as last resort
      const pages: Page[] = [];
      for (let i = 1; i <= totalPages; i++) {
        try {
          const pr = await this.get(`${this.baseUrl}/g/${galleryId}/${i}/`);
          const $$$ = this.$(pr.data);
          const imageUrl = this.imgAttr($$$('img#readerImg, img#gimg, img#fimg, #readerImg').first());
          if (imageUrl) pages.push({ index: i - 1, imageUrl });
        } catch { /* ignore */ }
      }
      if (pages.length > 0) return pages;
    }

    // Generic thumb fallback
    const generic = $('.hz-gallery-thumb img, .thumb img, img[src*="thumb"]').toArray()
      .map(el => this.imgAttr($(el))).filter(Boolean);
    return generic.map((imageUrl, idx) => ({ index: idx, imageUrl: imageUrl.replace(/t\.(jpg|jpeg|png).*$/i, '.$1') }));
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
