import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

// Transcompilation of keiyoushi `lib-multisrc/yiimanga` (Yiimanga.kt):
// plain-HTML catalogue (`/page/N/` lists, `/search/?s=` search), series
// pages at `/<mangaPath>/<slug>/` with `ul.chapter-list` chapters and
// `.reading-content img` pages. No JSON, no WebView, no auth — plain HTTP.

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Upstream `dateFormat`: "06 Oct 2026", "12 Oct 26" or "Oct 26" (day defaults to 1). */
export function parseYiimangaDate(raw: string | null | undefined): number {
  if (!raw) return 0;
  const text = raw.trim();
  if (!text) return 0;
  let m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4}|\d{2})$/.exec(text);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month === undefined) return 0;
    let year = Number(m[3]);
    if (m[3].length === 2) year += year >= 70 ? 1900 : 2000;
    return Date.UTC(year, month, Number(m[1]));
  }
  m = /^([A-Za-z]{3,})\s+(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month === undefined) return 0;
    let year = Number(m[2]);
    if (m[2].length === 2) year += year >= 70 ? 1900 : 2000;
    return Date.UTC(year, month, 1);
  }
  const fallback = Date.parse(text);
  return Number.isNaN(fallback) ? 0 : fallback;
}

export abstract class YiimangaScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang = 'en';

  protected abstract readonly mangaPath: string;
  protected readonly searchParam: string = 's';
  protected readonly popularPath: string | null = null;

  constructor(name: string, baseUrl: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  protected listUrl(...segments: string[]): (page: number) => string {
    return (page: number) => {
      const parts = [...segments, 'page', String(page), ''];
      return `${this.baseUrl}/${parts.join('/')}`.replace(/([^:])\/+/g, '$1/');
    };
  }

  private mangaListParse(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.latest-list .latest-item, .list .list-item').each((_i, element) => {
      const $el = $(element);
      const link = $el.find('.latest-right a:has(h3, h4), .item-title a').first();
      const href = link.attr('href');
      if (!href) return;
      const title = link.text().trim();
      if (!title) return;
      const thumb = $el.find('.latest-left img, .item-img img').first().attr('src') ?? '';
      mangas.push({
        title,
        url: this.toPath(href),
        thumbnailUrl: thumb ? this.absUrl(thumb) : '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('#pagination li.next a').length > 0 };
  }

  /** Equivalent of upstream `setUrlWithoutDomain`: stores the path part. */
  protected toPath(href: string): string {
    try {
      const url = new URL(href, this.baseUrl);
      return url.pathname + (url.search || '');
    } catch {
      return href;
    }
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (this.popularPath === null) return this.getLatest(page);
    const res = await this.get(`${this.listUrl(this.popularPath)(page)}?order=views`);
    return this.mangaListParse(res.data as string);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl()(page));
    return this.mangaListParse(res.data as string);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim()) {
      const url = new URL(`${this.baseUrl}/search/`);
      url.searchParams.set(this.searchParam, query.trim());
      url.searchParams.set('page', String(page));
      const res = await this.get(url.toString());
      return this.mangaListParse(res.data as string);
    }
    return this.getLatest(page);
  }

  private infoBlock($: CheerioAPI, ...labels: string[]): { text: string; html: string } | null {
    const headings = $('.main-info-list li > h5, .post-content_item .summary-heading > h5, .info-item > span.sh');
    for (const el of headings.toArray()) {
      const label = $(el).text().trim().replace(/:$/, '').replace(/ -$/, '');
      if (!labels.includes(label)) continue;
      const row = $(el).closest('li, .post-content_item, .info-item');
      const value = row.find('> :not(h5, .summary-heading, .sh)').first();
      if (value.length > 0) return { text: value.text(), html: value.html() ?? '' };
    }
    return null;
  }

  private names($: CheerioAPI, html: string): string | undefined {
    const $frag = this.$(`<div>${html}</div>`);
    const links = $frag('a').toArray();
    const names = links.length > 0
      ? links.map((a) => $frag(a).text().trim()).filter(Boolean)
      : [$frag('div').text().trim()].filter(Boolean);
    const joined = names.join(', ').trim();
    return joined || undefined;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const title = $('h1.main-info-title, .post-title h1, .manga-detail .info h1').first().text().trim();
    const thumbnail = $('img.img-cover, .summary_image img, .manga-detail .poster img').first().attr('src') ?? '';
    const author = this.infoBlock($, 'Author(s)', 'Author', 'Autores');
    const artist = this.infoBlock($, 'Artist(s)', 'Artist', 'Artistas');
    const genre = this.infoBlock($, 'Genres', 'Genre(s)', 'Géneros');
    const statusRaw = this.infoBlock($, 'Status', 'Estado')?.text.trim().toLowerCase()
      ?? $('.manga-detail .info p.type').first().text().trim().toLowerCase();
    const synopsisEl = $('.short-desc-content, .dsct, .description-summary').first();
    let synopsis = '';
    if (synopsisEl.length > 0) {
      const blocks = synopsisEl.find('p, li').toArray();
      const texts = (blocks.length > 0 ? blocks.map((b) => $(b).text().trim()) : [synopsisEl.text().trim()])
        .filter(Boolean);
      synopsis = texts.join('\n\n');
    }
    const altNames = this.infoBlock($, 'Alternative')?.text.trim()
      ?? $('.main-info-list li > h4, .manga-detail .info h6').first().text().trim();
    const description = [synopsis, altNames ? `Alternative names: ${altNames}` : '']
      .filter(Boolean).join('\n\n') || undefined;
    return {
      title: title || undefined,
      url: mangaUrl,
      thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : '',
      author: author ? this.names($, author.html) : undefined,
      artist: artist ? this.names($, artist.html) : undefined,
      genre: genre ? this.names($, genre.html) : undefined,
      status: statusRaw === 'ongoing' ? 1 : statusRaw === 'completed' ? 0 : undefined,
      description,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];
    $('ul.chapter-list li, ul.row-content-chapter li, .list-items li.item').each((_i, element) => {
      const $el = $(element);
      const href = $el.find('a[href]').first().attr('href');
      if (!href) return;
      const name = $el.find('.chapter-name, .item a > span:first-child').first().text().trim();
      if (!name) return;
      const dateText = $el.find('.ct-update, .chapter-time, .item a > span:nth-child(2)').first().text();
      const dateUpload = parseYiimangaDate(dateText);
      const num = Number.parseFloat(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? '');
      chapters.push({
        name,
        url: this.toPath(href),
        chapterNumber: Number.isFinite(num) ? num : undefined,
        dateUpload: dateUpload || undefined,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    return $('.reading-content img, .read-content img').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') ?? ''),
    }));
  }
}
