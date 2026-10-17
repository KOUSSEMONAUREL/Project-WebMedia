import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

export type RawEntries = 'show' | 'hide' | 'only';

// Transcompilation of keiyoushi `lib-multisrc/yiimadara` (YiiMadara.kt).
export abstract class YiiMadaraScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected mangaPath: string = 'manga';
  protected directoryPath: string | null = 'manga';
  protected pageSegment: boolean = false;
  protected trailingSlash: boolean = false;
  protected searchParam: string = 'q';
  protected completedPath: string | null = 'completed';
  protected rawPath: string | null = null;
  protected rawEntries: RawEntries = 'show';

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
    if (this.rawEntries === 'show') {
      this.rawEntries = lang === 'en' ? 'hide' : lang === 'ko' ? 'only' : 'show';
    }
  }

  protected toPath(href: string): string {
    try {
      const url = new URL(href, this.baseUrl);
      return url.pathname + (url.search || '');
    } catch {
      return href;
    }
  }

  protected listUrl(path: string, page: number): string {
    const parts = [this.baseUrl, ...path.split('/').filter(Boolean)];
    if (this.pageSegment) parts.push('page');
    parts.push(String(page));
    if (this.trailingSlash) parts.push('');
    return parts.join('/').replace(/([^:])\/+/g, '$1/');
  }

  private isRaw(url: string, title: string): boolean {
    return url.replace(/\/+$/, '').endsWith('-raw') || title.toLowerCase().endsWith(' raw');
  }

  private filterRaw(url: string, title: string, rawListing: boolean): boolean {
    const raw = this.isRaw(url, title);
    switch (this.rawEntries) {
      case 'show':
        return true;
      case 'hide':
        return rawListing || !raw;
      case 'only':
        return rawListing || raw;
    }
  }

  protected mangaListParse(html: string, rawListing: boolean = false): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.page-item, div.page-item-detail, div.home-item, div.manga-item').each((_, element) => {
      const $el = $(element);
      const link = $el.find('h3 a').first();
      const href = link.attr('href');
      if (!href) return;
      const title = link.text().trim();
      if (!title) return;
      const url = this.toPath(href);
      if (!this.filterRaw(url, title, rawListing)) return;
      const thumb = $el.find('img').first().attr('src') ?? '';
      mangas.push({
        title,
        url,
        thumbnailUrl: thumb ? this.absUrl(thumb) : '',
        lang: this.lang,
      });
    });
    const hasNextPage = $('#blog-pager li.next a').length > 0;
    return { mangas, hasNextPage };
  }

  private async directoryPage(page: number, order: string | null): Promise<SearchResult> {
    const path = this.directoryPath ?? 'manga';
    const u = new URL(this.listUrl(path, page));
    if (order) u.searchParams.set('orderby', order);
    const res = await this.get(u.toString());
    return this.mangaListParse(res.data as string, path === this.rawPath);
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    if (this.directoryPath === null) return this.getLatest(page);
    return this.directoryPage(page, 'trending');
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    if (this.directoryPath === null) return { mangas: [], hasNextPage: false };
    return this.directoryPage(page, null);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (trimmed) {
      let path = '/search';
      if (this.trailingSlash) path += '/';
      const u = new URL(this.baseUrl + path);
      u.searchParams.set(this.searchParam, trimmed.replace(/'/g, '\u2019'));
      u.searchParams.set('page', String(page));
      const res = await this.get(u.toString());
      return this.mangaListParse(res.data as string);
    }
    if (this.directoryPath === null) return this.getLatest(page);
    return this.directoryPage(page, null);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const heading = $('.post-title h1').first();
    const title = (heading.length ? heading.text() : '').trim();
    const thumbnail = $('.summary_image img').first().attr('src') ?? '';
    const info = (label: string) => {
      const item = $('.post-content_item').toArray().find((el) => {
        const h = $(el).find('> .summary-heading, > b').first().text().trim().replace(/:$/, '');
        return h.toLowerCase().startsWith(label.toLowerCase());
      });
      if (!item) {
        const minfo = $('.minfo').toArray().find((el) => $(el).text().trim().toLowerCase().startsWith(label.toLowerCase()));
        if (!minfo) return null;
        const vals = $(minfo).find('> i');
        return vals.length ? vals : null;
      }
      const vals = $(item).find('> .summary-content');
      return vals.length ? vals : $(item).find('> :not(b)');
    };
    const value = (label: string): string | null => {
      const el = info(label);
      if (!el || el.length === 0) return null;
      const text = el.text().trim();
      if (!text || text === 'Updating' || text === 'N/A') return null;
      return text;
    };
    const names = (label: string): string | undefined => {
      const el = info(label);
      if (!el || el.length === 0) return undefined;
      const links = el.find('a');
      const arr = links.length > 0 ? links.toArray().map((a) => $(a).text().trim()) : [el.text().trim()];
      const filtered = arr.filter((t) => t && t !== 'Updating');
      return filtered.length ? filtered.join(', ') : undefined;
    };
    const statusRaw = (value('Status') ?? '').toLowerCase();
    const synopsisEl = $('.dsct, .ss-manga, .post-content_item .entry-content').first();
    let synopsis = '';
    if (synopsisEl.length > 0) {
      const blocks = synopsisEl.find('p, li').toArray();
      const texts = (blocks.length > 0 ? blocks.map((b) => $(b).text().trim()) : [synopsisEl.text().trim()]).filter(Boolean);
      synopsis = texts.join('\n\n');
    }
    const altNames = value('Alternative') ?? '';
    const description = [synopsis, altNames ? `Alternative names: ${altNames}` : ''].filter(Boolean).join('\n\n') || undefined;
    const genreParts = [names('Genre'), value('Type')].filter(Boolean);
    return {
      title: title || undefined,
      url: mangaUrl,
      thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : '',
      author: names('Author'),
      artist: names('Artist'),
      genre: genreParts.length ? genreParts.join(', ') : undefined,
      status: statusRaw === 'ongoing' ? 1 : statusRaw === 'completed' ? 0 : undefined,
      description,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];
    $('ul.row-content-chapter li').each((_, element) => {
      const $el = $(element);
      const link = $el.find('a').first();
      const href = link.attr('href');
      if (!href) return;
      const name = link.text().trim();
      if (!name) return;
      const dateText = $el.find('.chapter-time').first().text().trim();
      // parse date best effort
      const dateUpload = parseDate(dateText);
      chapters.push({
        name,
        url: this.toPath(href),
        chapterNumber: numberFromName(name),
        dateUpload: dateUpload || undefined,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const pages: Page[] = [];
    $('.read-content img').each((index, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src') || '';
      const imageUrl = src ? this.absUrl(src) : '';
      if (!imageUrl) return;
      pages.push({ index, imageUrl });
    });
    return pages;
  }
}

function numberFromName(name: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)/.exec(name);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function parseDate(raw: string): number {
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}
