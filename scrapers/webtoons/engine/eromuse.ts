import { BaseScraper } from './base';
import type { Chapter, Manga, Page, SearchResult } from './types';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

export const VARIOUS_AUTHORS = 0;
export const AUTHOR = 1;
export const SEARCH_RESULTS_OR_BASE = 2;

interface StackItem {
  url: string;
  pageType: number;
}

type AlbumEntry = [label: string, path: string, pageType: number];

const PAGE_QUERY_RE = /page=\d+/;
const MAX_FETCHES = 30;

export abstract class EroMuseScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  // ---- overridable theme hooks (defaults = 8muses) ----

  protected albumSelector = 'a.c-tile:has(img):not(:has(.members-only))';
  protected topLevelPathSegment = 'comics/album';
  protected linkedChapterSelector = 'a.c-tile:has(img)[href*="/comics/album/"]';
  protected pageThumbnailSelector = 'a.c-tile:has(img)[href*="/comics/picture/"] img';
  protected pageThumbnailPathSegment = '/th/';
  protected pageFullSizePathSegment = '/fl/';

  protected popularUrl(): string {
    return `${this.baseUrl}/comics/album/Various-Authors`;
  }
  protected popularSortingMode = '';

  protected latestUrl(): string {
    return `${this.baseUrl}/comics/album/Various-Authors?sort=date`;
  }
  protected latestSortingMode = 'date';

  protected searchUrl(query: string, sortingMode: string): string {
    const params = new URLSearchParams({ q: query });
    if (sortingMode) params.set('sort', sortingMode);
    params.set('page', '1');
    return `${this.baseUrl}/search?${params.toString()}`;
  }

  protected browseUrl(sortingMode: string): string {
    const params = new URLSearchParams();
    if (sortingMode) params.set('sort', sortingMode);
    params.set('page', '1');
    return `${this.baseUrl}/comics/?${params.toString()}`;
  }

  // Only VARIOUS_AUTHORS entries are needed: unknown albums fall back to
  // AUTHOR, which is exactly upstream's default parameter value.
  protected albumEntries(): AlbumEntry[] {
    return [
      ['All Authors', '', SEARCH_RESULTS_OR_BASE],
      ['Various Authors', 'album/Various-Authors', VARIOUS_AUTHORS],
      ['Fakku Comics', 'album/Fakku-Comics', VARIOUS_AUTHORS],
      ['Hentai and Manga English', 'album/Hentai-and-Manga-English', VARIOUS_AUTHORS],
    ];
  }

  protected authorFromDetails(authorType: number, title: string, get: (sel: string) => string): string | undefined {
    void title;
    if (authorType === AUTHOR) return get('div.top-menu-breadcrumb li:nth-child(2)') || undefined;
    if (authorType === VARIOUS_AUTHORS) return get('div.top-menu-breadcrumb li:nth-child(3)') || undefined;
    return undefined;
  }

  protected genreFromDetails(all: (sel: string) => string[]): string | undefined {
    void all;
    return undefined;
  }

  // ---- stack machine (mirrors upstream fetchManga/parseManga) ----

  private pageStack: StackItem[] = [];
  private stackItem: StackItem = { url: '', pageType: SEARCH_RESULTS_OR_BASE };
  private currentSortingMode = '';
  private fetchCount = 0;

  private async fetchDoc(url: string): Promise<{ html: string; url: string }> {
    if (this.fetchCount++ >= MAX_FETCHES) throw new Error('Fetch limit reached');
    const res = await this.get(url);
    return { html: String(res.data), url };
  }

  private stackUrl(): string {
    const item = this.pageStack.pop();
    if (!item) throw new Error('Empty page stack');
    this.stackItem = item;
    if (item.pageType === AUTHOR && this.currentSortingMode && !item.url.includes('sort')) {
      const u = new URL(item.url);
      u.searchParams.append('sort', this.currentSortingMode);
      return u.toString();
    }
    return item.url;
  }

  private nextPageOrNull(html: string, docUrl: string): string | null {
    const $ = this.$(html);
    const num = Number($('.pagination span.current + span a').first().text().trim());
    if (!Number.isInteger(num) || num <= 0) return null;
    if (PAGE_QUERY_RE.test(docUrl)) return docUrl.replace(PAGE_QUERY_RE, `page=${num}`);
    try {
      const u = new URL(docUrl);
      const parts = u.pathname.split('/').filter(s => s.length > 0);
      if (parts.length > 0 && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
      u.pathname = `/${[...parts, String(num)].join('/')}`;
      return u.toString();
    } catch {
      return null;
    }
  }

  private addNextPageToStack(html: string, docUrl: string): void {
    const next = this.nextPageOrNull(html, docUrl);
    if (next) this.pageStack.push({ url: next, pageType: this.stackItem.pageType });
  }

  private imgAttr($img: Cheerio<AnyNode>): string {
    const raw = $img.attr('data-src') || $img.attr('src') || '';
    return this.absUrl(raw);
  }

  private mangaFromElement($: CheerioAPI, el: AnyNode): Manga | null {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href) return null;
    const title = $el.text().trim();
    if (!title) return null;
    const $img = $el.find('img').first();
    return {
      title,
      url: this.absUrl(href),
      thumbnailUrl: $img.length > 0 ? this.imgAttr($img) : '',
      lang: this.lang,
    };
  }

  private getAlbumType(url: string): number {
    const hit = this.albumEntries().find(
      e => e[2] !== SEARCH_RESULTS_OR_BASE && url.toLowerCase().includes(e[1].toLowerCase()),
    );
    return hit ? hit[2] : AUTHOR;
  }

  private albumHrefs($: CheerioAPI): string[] {
    return $(this.albumSelector)
      .toArray()
      .map(el => {
        const href = $(el).attr('href');
        return href ? this.absUrl(href) : '';
      })
      .filter(Boolean);
  }

  private async internalParse(html: string, docUrl: string): Promise<Manga[]> {
    let doc = { html, url: docUrl };
    if (this.stackItem.pageType === VARIOUS_AUTHORS) {
      for (const href of [...this.albumHrefs(this.$(html))].reverse()) {
        this.pageStack.push({ url: href, pageType: AUTHOR });
      }
      doc = await this.fetchDoc(this.stackUrl());
    }
    this.addNextPageToStack(doc.html, doc.url);
    const $ = this.$(doc.html);
    return $(this.albumSelector)
      .toArray()
      .map(el => this.mangaFromElement($, el))
      .filter((m): m is Manga => m !== null);
  }

  private async parseManga(html: string, docUrl: string): Promise<SearchResult> {
    if (this.stackItem.pageType === VARIOUS_AUTHORS || this.stackItem.pageType === SEARCH_RESULTS_OR_BASE) {
      this.addNextPageToStack(html, docUrl);
    }
    let mangas: Manga[] = [];
    if (this.stackItem.pageType === VARIOUS_AUTHORS) {
      for (const href of [...this.albumHrefs(this.$(html))].reverse()) {
        this.pageStack.push({ url: href, pageType: AUTHOR });
      }
      mangas = await this.internalParse(html, docUrl);
    } else if (this.stackItem.pageType === AUTHOR) {
      mangas = await this.internalParse(html, docUrl);
    } else if (this.stackItem.pageType === SEARCH_RESULTS_OR_BASE) {
      const $ = this.$(html);
      const prefix = `${this.baseUrl}/${this.topLevelPathSegment}/`;
      for (const el of $(this.albumSelector).toArray()) {
        const $el = $(el);
        const href = $el.attr('href');
        if (!href) continue;
        const url = this.absUrl(href);
        const depth = url.startsWith(prefix) ? url.slice(prefix.length).split('/').length : 99;
        const albumType = this.getAlbumType(url);
        if (albumType === VARIOUS_AUTHORS) {
          if (depth <= 2) {
            this.pageStack.push({ url, pageType: depth === 1 ? VARIOUS_AUTHORS : AUTHOR });
            if (mangas.length === 0) {
              const doc = await this.fetchDoc(this.stackUrl());
              mangas = await this.internalParse(doc.html, doc.url);
            }
          } else {
            const m = this.mangaFromElement($, el);
            if (m) mangas.push(m);
          }
        } else if (albumType === AUTHOR) {
          if (depth === 1) {
            this.pageStack.push({ url, pageType: AUTHOR });
            if (mangas.length === 0) {
              const doc = await this.fetchDoc(this.stackUrl());
              mangas = await this.internalParse(doc.html, doc.url);
            }
          } else {
            const m = this.mangaFromElement($, el);
            if (m) mangas.push(m);
          }
        }
      }
    }
    return { mangas, hasNextPage: this.pageStack.length > 0 };
  }

  private async fetchManga(url: string, page: number, sortingMode: string): Promise<SearchResult> {
    if (page === 1) {
      this.pageStack = [];
      this.fetchCount = 0;
      this.pageStack.push({ url, pageType: VARIOUS_AUTHORS });
      this.currentSortingMode = sortingMode;
    }
    const doc = await this.fetchDoc(this.stackUrl());
    return this.parseManga(doc.html, doc.url);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchManga(this.popularUrl(), page, this.popularSortingMode);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.fetchManga(this.latestUrl(), page, this.latestSortingMode);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (page === 1) {
      this.pageStack = [];
      this.fetchCount = 0;
      this.currentSortingMode = '';
      const q = query.trim();
      if (q) {
        this.pageStack.push({ url: this.searchUrl(q, ''), pageType: SEARCH_RESULTS_OR_BASE });
      } else {
        this.pageStack.push({ url: this.browseUrl(''), pageType: SEARCH_RESULTS_OR_BASE });
      }
    }
    const doc = await this.fetchDoc(this.stackUrl());
    return this.parseManga(doc.html, doc.url);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const doc = await this.fetchDoc(this.absUrl(mangaUrl));
    const $ = this.$(doc.html);
    const text = (sel: string): string => $(sel).first().text().trim();
    const title = $('title').first().text().split(' | ')[0].trim();
    if (!title) throw new Error('Title not found');
    const $thumb = $(`${this.albumSelector} img`).first();
    const albumType = this.getAlbumType(doc.url);
    const all = (sel: string): string[] =>
      $(sel)
        .toArray()
        .map(el => $(el).text().trim())
        .filter(Boolean);
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: $thumb.length > 0 ? this.imgAttr($thumb) : '',
      lang: this.lang,
      author: this.authorFromDetails(albumType, title, text),
      genre: this.genreFromDetails(all),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const doc = await this.fetchDoc(this.absUrl(mangaUrl));
    const chapters: Chapter[] = [];
    await this.parseChapters(doc.html, doc.url, true, chapters);
    return chapters;
  }

  private async parseChapters(html: string, docUrl: string, isFirstPage: boolean, chapters: Chapter[]): Promise<void> {
    const $ = this.$(html);
    $(this.linkedChapterSelector).each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href) return;
      chapters.unshift({ name: $a.text().trim() || 'Chapter', url: this.absUrl(href) });
    });
    if (isFirstPage) {
      if ($(this.pageThumbnailSelector).length > 0) {
        chapters.push({ name: 'Chapter', url: this.absUrl(docUrl) });
      }
    }
    const next = this.nextPageOrNull(html, docUrl);
    if (next && this.fetchCount < MAX_FETCHES) {
      const doc = await this.fetchDoc(next);
      await this.parseChapters(doc.html, doc.url, false, chapters);
    }
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const doc = await this.fetchDoc(this.absUrl(chapterUrl));
    const pages: Page[] = [];
    await this.parsePages(doc.html, doc.url, [], pages);
    return pages;
  }

  private async parsePages(
    html: string,
    docUrl: string,
    nested: Array<{ html: string; url: string }>,
    pages: Page[],
  ): Promise<void> {
    const $ = this.$(html);
    for (const el of $(this.linkedChapterSelector).toArray()) {
      const href = $(el).attr('href');
      if (!href || this.fetchCount >= MAX_FETCHES) continue;
      nested.push(await this.fetchDoc(this.absUrl(href)));
    }
    $(this.pageThumbnailSelector).each((_, img) => {
      const raw = $(img).attr('data-src') || $(img).attr('src') || '';
      if (!raw) return;
      pages.push({
        index: pages.length,
        imageUrl: this.absUrl(raw).replace(this.pageThumbnailPathSegment, this.pageFullSizePathSegment),
      });
    });
    const next = this.nextPageOrNull(html, docUrl);
    if (next && this.fetchCount < MAX_FETCHES) {
      const doc = await this.fetchDoc(next);
      await this.parsePages(doc.html, doc.url, nested, pages);
    }
    while (nested.length > 0 && this.fetchCount < MAX_FETCHES) {
      const doc = nested.shift();
      if (!doc) break;
      const subPages: Page[] = [];
      await this.parsePages(doc.html, doc.url, [], subPages);
      for (const p of subPages) pages.push({ index: pages.length, imageUrl: p.imageUrl });
    }
  }
}
