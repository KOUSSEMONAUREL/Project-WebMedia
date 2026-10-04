import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/ebookrenta` (EbookRenta.kt + Dto.kt).
 *
 * HTML lists at `/renta/sc/frm/search`, details at `/renta/sc/frm/item/<id>`
 * with chapters embedded as `ItemStore.set(...)` JSON (`JSON.parse(`...`)`),
 * pages built from viewer vars (`url_base2`, `max_page`, `auth_key`, `prd_ser`).
 * The site requires `r18=1` + `rbc=1002` cookies, sent on every request.
 */

interface RentaItemDto {
  prd_ser: string;
  prd_name: string;
  date_s: string;
  prd_rental: number;
  prd_rental_free: number;
  prd_rental_free_buy: number;
  prd_rental_all_free: number;
  prd_rental_all_free_buy: number;
  prd_rental_future: number;
  block_sample: number;
}

export class EbookRentaScraper extends BaseScraper {
  readonly name = 'EbookRenta';
  readonly baseUrl = 'https://www.ebookrenta.com';
  readonly lang = 'en';

  private readonly cookies = 'r18=1; rbc=1002';

  private async fetchSearch(query: string, page: number, sort: string): Promise<SearchResult> {
    const params = new URLSearchParams({ word: query, sort, type: 'desc', page: String(page) });
    const res = await this.get(`${this.baseUrl}/renta/sc/frm/search?${params.toString()}`, {
      headers: { Cookie: this.cookies },
    });
    const $ = this.$(res.data);
    const mangas: Manga[] = $('.search-typeDesc-listItem').toArray().map(node => {
      const $item = $(node);
      const link = $item.find('a.search-typeDesc-titleLink').first();
      const href = link.attr('href') || '';
      const id = href.split('/').filter(Boolean).pop() || href;
      return {
        title: link.text().trim(),
        url: id,
        thumbnailUrl: $item.find('img').first().attr('src') || '',
        lang: this.lang,
      };
    });
    const pager = $('#ja-search-Pn-wrap');
    const hasNextPage = pager.length > 0 && pager.attr('data-now') !== pager.attr('data-max');
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchSearch('', page, '3');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.fetchSearch('', page, '');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.fetchSearch(query.trim(), page, '3');
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const res = await this.get(`${this.baseUrl}/renta/sc/frm/item/${id}`, {
      headers: { Cookie: this.cookies },
    });
    const $ = this.$(res.data);
    const title = $('h1.fvSeries-desc-title').first().text().trim();
    const author = $('#js-productDetailsSection [data-schema-attribute=author] a').toArray()
      .map(a => $(a).text().trim()).filter(Boolean).join(', ') || undefined;
    const description = $('[data-text-type=textViewMore_toggle]').first().text().trim() || undefined;
    const genre = $('.item-tags_wrap a:not([href*=price])').toArray()
      .map(a => $(a).text().trim().replace(/_/g, ' ')).filter(Boolean).join(', ') || undefined;
    const status: Manga['status'] = $('.item-tags_wrap a[href$="keyword=Completed"]').length > 0 ? 0 : 1;
    const thumbnailUrl = $('img.fvSeries-cover-image').first().attr('src') || '';
    return { title, url: id, thumbnailUrl, lang: this.lang, author, description, genre, status };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const res = await this.get(`${this.baseUrl}/renta/sc/frm/item/${id}`, {
      headers: { Cookie: this.cookies },
    });
    const $ = this.$(res.data);
    const scripts = $('script').toArray().map(s => $(s).html() || '');
    const script = scripts.find(t => t.includes('ItemStore.set'));
    if (!script) return [];
    const marker = 'JSON.parse(';
    const startIdx = script.indexOf(marker);
    if (startIdx < 0) return [];
    const after = script.slice(startIdx + marker.length);
    const bt = String.fromCharCode(96);
    let raw: string;
    if (after.trimStart().startsWith(bt)) {
      const inner = after.slice(after.indexOf(bt) + 1);
      raw = inner.split(bt + ');')[0] || '';
    } else {
      raw = after;
    }
    const unescaped = raw.replace(/\\(.)/g, '$1');
    let items: Record<string, RentaItemDto>;
    try {
      items = JSON.parse(unescaped) as Record<string, RentaItemDto>;
    } catch {
      return [];
    }
    const chapters: Chapter[] = Object.values(items)
      .filter(item => item.prd_rental_future !== 1)
      .map(item => {
        const isFree = item.prd_rental_free === 1 || item.prd_rental_free_buy === 1 ||
          item.prd_rental_all_free === 1 || item.prd_rental_all_free_buy === 1;
        const isLocked = item.prd_rental !== 1 && item.prd_rental !== 4 && !isFree;
        const isPreview = isLocked && item.block_sample === 1;
        const prefix = !isLocked ? '' : isPreview ? '🔒 (Preview) ' : '🔒 ';
        const type = item.prd_rental !== 1 && isFree ? 'free' : isPreview ? 'smpl' : 'read';
        void type;
        return {
          name: `${prefix}${item.prd_name}`,
          url: `${id}#${item.prd_ser}#${type}`,
          dateUpload: item.date_s ? Date.parse(item.date_s) : undefined,
        };
      });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('#');
    const prdSer = parts[parts.length - 2] || parts.pop() || '';
    const type = parts[parts.length - 1] || 'read';
    void type;
    const mangaId = parts[0]?.split('/').filter(Boolean).pop() || '';
    void mangaId;
    let doc = await this.get(
      `${this.baseUrl}/renta/sc/jump/viewer?type=${type}&prd_tid=9-${prdSer}&style=ch`,
      { headers: { Cookie: this.cookies } },
    ).then(r => this.$(r.data));
    const refresh = doc('meta[http-equiv=refresh]').first().attr('content') || '';
    if (refresh.includes('URL=')) {
      const nextUrl = refresh.split('URL=')[1] || '';
      const res = await this.get(nextUrl, { headers: { Cookie: this.cookies } });
      doc = this.$(res.data);
    }
    const script = doc('script:contains("url_base2")').toArray()
      .map(s => doc(s).html() || '')
      .find(t => t.includes('url_base2'));
    if (!script) throw new Error('Log in via WebView and purchase this chapter to read.');
    const vars: Record<string, string> = {};
    const re = /(\w+)\s*=\s*(?:parseInt\()?\"([^\"]*)\"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(script)) !== null) vars[m[1]] = m[2];
    const base = vars['url_base2'];
    const maxPage = parseInt(vars['max_page'] || '0', 10);
    if (!base || !maxPage) throw new Error('Log in via WebView and purchase this chapter to read.');
    const authKey = vars['auth_key'] || '';
    const prdSerVar = vars['prd_ser'] || '';
    return Array.from({ length: maxPage }, (_, i) => {
      const sep = base.includes('?') ? '&' : '?';
      const url = `${base}/${i + 1}${sep}${authKey}#${prdSerVar}`;
      void sep;
      return { index: i, imageUrl: url };
    });
  }
}
