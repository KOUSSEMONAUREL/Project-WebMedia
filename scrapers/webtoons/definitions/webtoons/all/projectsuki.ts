import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

interface BookSearchResponse {
  data?: Record<string, { value: string }>;
}

interface ChapterPagesResponse {
  src: string;
}

const IMAGE_EXTENSIONS = ['.jpg', '.png', '.jpeg', '.webp', '.gif', '.avif', '.tiff'];

const CHAPTER_NUMBER_REGEX = /(?:chapter|ch\.?)\s*(\d+)(?:\s*[.,-]\s*(\d+)?)?/i;
const RELATIVE_DATE_REGEX = /(\d+)\s+(years?|months?|weeks?|days?|hours?|mins?|minutes?|seconds?|sec)\s+ago/i;

export class ProjectSukiScraper extends BaseScraper {
  readonly name = 'Project Suki';
  readonly baseUrl = 'https://projectsuki.com';
  readonly lang = 'all';

  private bookSearchCache: Map<string, string> | null = null;

  private bookThumbnailUrl(bookId: string, extension: string): string {
    const suffix = extension ? `thumb.${extension}` : 'thumb';
    return `${this.baseUrl}/images/gallery/${bookId}/${suffix}`;
  }

  private matchBookUrl(href: string): string | null {
    const m = /^\/book\/([^/?#]+)\/?$/i.exec(href.split('?')[0]);
    return m ? m[1] : null;
  }

  private matchChapterUrl(href: string): { bookId: string; chapterId: string } | null {
    const m = /^\/read\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(href.split('?')[0]);
    return m ? { bookId: m[1], chapterId: m[2] } : null;
  }

  private matchPageUrl(src: string): { pageNum: number } | null {
    const clean = src.split('?')[0];
    const m = /^\/images\/gallery\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(clean);
    if (!m || /^(\d+-)?thumb(\..+)?$/i.test(m[3])) return null;
    const num = parseInt(m[3].replace(/\D/g, ''), 10);
    if (Number.isNaN(num)) return null;
    return { pageNum: num };
  }

  private matchThumbnailUrl(src: string): string | null {
    const clean = src.split('?')[0];
    const m = /^\/images\/gallery\/[^/?#]+\/(\d+-)?thumb(?:\.(.+))?$/i.exec(clean);
    if (!m) return null;
    return m[2] || '';
  }

  private imageSrc($el: Cheerio<Element>): string | null {
    for (const variant of ['src', 'data-src', 'data-lazy-src']) {
      const v = $el.attr(variant);
      if (v) return v;
    }
    const srcset = $el.attr('srcset');
    if (srcset) return srcset.split(' ')[0];
    const attribs = ($el.get(0) as unknown as { attribs?: Record<string, string> }).attribs || {};
    for (const [key, value] of Object.entries(attribs)) {
      if (key.includes('src') && IMAGE_EXTENSIONS.some(ext => value.includes(ext))) {
        return value.split(' ')[0];
      }
    }
    return null;
  }

  private parseBooksPage(html: string, overrideHasNextPage?: boolean): SearchResult {
    const $ = this.$(html);
    const byId = new Map<string, { title?: string; extension?: string }>();
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      if (!href.includes(this.baseUrl) && href.startsWith('http')) return;
      const path = href.startsWith('http') ? new URL(href).pathname : href;
      const bookId = this.matchBookUrl(path);
      if (!bookId) return;
      const entry = byId.get(bookId) || {};
      const imgSrc = $a.find('img').first().length
        ? this.imageSrc($a.find('img').first())
        : null;
      if (imgSrc) {
        const imgPath = imgSrc.startsWith('http') ? new URL(imgSrc).pathname : imgSrc;
        const ext = this.matchThumbnailUrl(imgPath);
        if (ext !== null && entry.extension === undefined) entry.extension = ext;
      } else {
        const inSmall = $a.parents('small').length > 0;
        const text = ($a.text() || '').trim();
        if (!inSmall && text && !/^show more$/i.test(text) && !entry.title) {
          entry.title = text;
        }
      }
      byId.set(bookId, entry);
    });
    const mangas: Manga[] = [];
    for (const [bookId, entry] of byId) {
      if (!entry.title) continue;
      mangas.push({
        url: `/book/${bookId}`,
        title: entry.title,
        thumbnailUrl: this.bookThumbnailUrl(bookId, entry.extension || ''),
        lang: this.lang,
      });
    }
    return { mangas, hasNextPage: overrideHasNextPage ?? mangas.length >= 30 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const response = await this.get(`/browse/${page - 1}`);
    return this.parseBooksPage(response.data as string);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const response = await this.get('/');
    return this.parseBooksPage(response.data as string, false);
  }

  private async fetchBookSearchMap(): Promise<Map<string, string>> {
    if (this.bookSearchCache) return this.bookSearchCache;
    const response = await this.post(
      '/api/book/search',
      { hash: null },
      {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${this.baseUrl}/browse`,
          'Content-Type': 'application/json',
        },
      },
    );
    const dto = response.data as BookSearchResponse;
    const map = new Map<string, string>();
    for (const [bookId, book] of Object.entries(dto.data || {})) {
      map.set(bookId, book.value);
    }
    this.bookSearchCache = map;
    return map;
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return { mangas: [], hasNextPage: false };

    if (/^https?:\/\//i.test(trimmed)) {
      let path: string;
      try {
        const url = new URL(trimmed);
        if (!url.host.endsWith('projectsuki.com')) throw new Error('Unsupported url');
        path = url.pathname;
      } catch {
        throw new Error('Unsupported url');
      }
      const bookId = this.matchBookUrl(path);
      const readMatch = this.matchChapterUrl(path);
      const targetBookId = bookId || readMatch?.bookId;
      if (targetBookId) {
        const details = await this.getMangaDetails(`/book/${targetBookId}`);
        return {
          mangas: [{
            url: `/book/${targetBookId}`,
            title: details.title || targetBookId,
            thumbnailUrl: details.thumbnailUrl || this.bookThumbnailUrl(targetBookId, ''),
            lang: this.lang,
          }],
          hasNextPage: false,
        };
      }
      throw new Error('Unsupported url');
    }

    const genreMatch = /^genre:\s*(.+)$/i.exec(trimmed);
    if (genreMatch) {
      const response = await this.get(`/genre/${encodeURIComponent(genreMatch[1].trim())}`);
      return this.parseBooksPage(response.data as string, false);
    }

    const words = trimmed.toLowerCase().match(/[a-z0-9]+/gi) || [];
    if (words.length === 0) {
      const url = `/search?page=${page - 1}&q=${encodeURIComponent(trimmed)}`;
      const response = await this.get(url);
      return this.parseBooksPage(response.data as string);
    }

    const books = await this.fetchBookSearchMap();
    const scored: { bookId: string; title: string; count: number }[] = [];
    for (const [bookId, title] of books) {
      const lower = title.toLowerCase();
      let count = 0;
      for (const word of words) {
        let idx = 0;
        for (;;) {
          const found = lower.indexOf(word.toLowerCase(), idx);
          if (found < 0) break;
          idx = found + 1;
          count++;
        }
      }
      if (count > 0) scored.push({ bookId, title, count });
    }
    scored.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    return {
      mangas: scored.map(s => ({
        url: `/book/${s.bookId}`,
        title: s.title,
        thumbnailUrl: this.bookThumbnailUrl(s.bookId, ''),
        lang: this.lang,
      })),
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data as string);
    const bookIdMatch = /\/book\/([^/?#]+)/i.exec(mangaUrl);
    const bookId = bookIdMatch ? bookIdMatch[1] : '';

    const title = ($('h2[itemprop=title]').first().text() || $('h2').first().text() || '').trim();

    let thumbnailExt = '';
    $('img').each((_, el) => {
      if (thumbnailExt) return;
      const src = this.imageSrc($(el));
      if (!src) return;
      const imgPath = src.startsWith('http') ? new URL(src).pathname : src;
      const ext = this.matchThumbnailUrl(imgPath);
      if (ext !== null) thumbnailExt = ext;
    });

    const details = new Map<string, string>();
    $('table tr').each((_, el) => {
      const $row = $(el);
      const cols = $row.children('td');
      if (cols.length < 2) return;
      const label = $(cols[0]).text().trim().toLowerCase();
      const value = $(cols[1]).text().trim();
      if (/authors?/.test(label)) details.set('author', value);
      else if (/artists?/.test(label)) details.set('artist', value);
      else if (/^status/.test(label)) details.set('status', value);
      else if (/^origin/.test(label)) details.set('origin', value);
      else if (/release/.test(label)) details.set('year', value);
      else if (/genre/.test(label)) details.set('genre', value);
    });

    const statusText = (details.get('status') || '').toLowerCase();
    const status = statusText === 'ongoing' ? 1
      : statusText === 'completed' ? 0
      : statusText === 'hiatus' || statusText === 'cancelled' ? 2
      : 3;

    let genre = details.get('genre') || '';
    const origin = details.get('origin') || '';
    const originGenre = /kr|korea/i.test(origin) ? 'Manhwa'
      : /cn|china/i.test(origin) ? 'Manhua'
      : /jp|japan/i.test(origin) ? 'Manga'
      : '';
    if (originGenre) genre = genre ? `${genre}, ${originGenre}` : originGenre;

    const description = $('#descriptionCollapse').text().trim()
      || $('.description').map((_, el) => $(el).text().trim()).get().join('\n\n');

    const detailLines: string[] = [];
    if (details.get('author')) detailLines.push(`Authors:  ${details.get('author')}`);
    if (details.get('artist')) detailLines.push(`Artists:  ${details.get('artist')}`);
    if (details.get('status')) detailLines.push(`Status:  ${details.get('status')}`);
    if (details.get('origin')) detailLines.push(`Origin:  ${details.get('origin')}`);
    if (details.get('year')) detailLines.push(`Release year:  ${details.get('year')}`);
    if (genre) detailLines.push(`Genres:  ${genre}`);
    const fullDescription = detailLines.length
      ? `${description}\n\n/=/-/=/-/=/-/=/-/=/-/=/-/=/-/=/\n\n${detailLines.join('\n')}`
      : description;

    return {
      title: title || undefined,
      author: details.get('author'),
      artist: details.get('artist'),
      description: fullDescription || undefined,
      genre: genre || undefined,
      status: status as 0 | 1 | 2 | 3,
      thumbnailUrl: bookId ? this.bookThumbnailUrl(bookId, thumbnailExt) : undefined,
    };
  }

  private parseChapterNumber(title: string): number {
    const m = CHAPTER_NUMBER_REGEX.exec(title);
    if (!m) return 0;
    const main = parseInt(m[1], 10);
    const sub = m[2] ? parseInt(m[2], 10) : 0;
    if (!sub) return main;
    const digits = 1 + Math.floor(Math.log10(sub));
    return main + sub / Math.pow(10, digits);
  }

  private parseChapterDate(text: string): number | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const rel = RELATIVE_DATE_REGEX.exec(trimmed);
    if (rel) {
      const n = parseInt(rel[1], 10);
      const unit = rel[2].toLowerCase();
      const d = new Date();
      if (unit.startsWith('year')) d.setFullYear(d.getFullYear() - n);
      else if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
      else if (unit.startsWith('week')) d.setDate(d.getDate() - n * 7);
      else if (unit.startsWith('day')) d.setDate(d.getDate() - n);
      else if (unit.startsWith('hour')) d.setHours(d.getHours() - n);
      else if (unit.startsWith('min')) d.setMinutes(d.getMinutes() - n);
      else d.setSeconds(d.getSeconds() - n);
      return d.getTime();
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data as string);
    const chapters: Chapter[] = [];

    $('table').each((_, table) => {
      const $table = $(table);
      const headerTexts = $table.find('thead tr td').map((_, el) => $(el).text().trim().toLowerCase()).get();
      const hasChapter = headerTexts.some(t => /^chapters?$/.test(t));
      const hasGroup = headerTexts.some(t => /^groups?$/.test(t));
      const hasAdded = headerTexts.some(t => /added|date/.test(t));
      if (!hasChapter || !hasGroup || !hasAdded) return;
      const colIndex = (re: RegExp): number => headerTexts.findIndex(t => re.test(t));
      const chapterCol = colIndex(/^chapters?$/);
      const groupCol = colIndex(/^groups?$/);
      const addedCol = colIndex(/added|date/);
      const langCol = colIndex(/^language$/);

      $table.find('tbody tr').each((_, row) => {
        const cols = $(row).children('td');
        if (cols.length !== headerTexts.length) return;
        const $chapterCell = $(cols[chapterCol]);
        const href = $chapterCell.find('a[href]').first().attr('href') || '';
        const path = href.startsWith('http') ? new URL(href).pathname : href;
        const match = this.matchChapterUrl(path);
        if (!match) return;
        const chapterTitle = $chapterCell.text().trim();
        const group = $(cols[groupCol]).text().trim();
        const dateText = $(cols[addedCol]).text().trim();
        const language = langCol >= 0 ? ($(cols[langCol]).text().trim().toLowerCase() || 'unknown') : 'unknown';
        chapters.push({
          url: `/read/${match.bookId}/${match.chapterId}/1`,
          name: chapterTitle,
          chapterNumber: this.parseChapterNumber(chapterTitle),
          scanlator: `${group} | ${language.charAt(0).toUpperCase()}${language.slice(1)}`,
          dateUpload: this.parseChapterDate(dateText),
        });
      });
    });

    chapters.sort((a, b) => (b.chapterNumber || 0) - (a.chapterNumber || 0));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const path = chapterUrl.startsWith('http') ? new URL(chapterUrl).pathname : chapterUrl;
    const match = this.matchChapterUrl(path);
    if (!match) throw new Error(`Project Suki: chapter url ${chapterUrl} does not match expected pattern`);
    const response = await this.post(
      '/callpage',
      { bookid: match.bookId, chapterid: match.chapterId, first: 'true' },
      {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
        },
      },
    );
    const dto = response.data as ChapterPagesResponse;
    const $ = this.$(dto.src || '');
    const urls: { url: string; pageNum: number }[] = [];
    $('img').each((_, el) => {
      const src = this.imageSrc($(el));
      if (!src) return;
      const abs = src.startsWith('http') ? src : this.absUrl(src);
      const imgPath = abs.startsWith('http') ? new URL(abs).pathname : abs;
      const pageMatch = this.matchPageUrl(imgPath);
      if (pageMatch) urls.push({ url: abs, pageNum: pageMatch.pageNum });
    });
    if (urls.length === 0) throw new Error('Project Suki: chapter pages URLs aren\'t in the expected format!');
    urls.sort((a, b) => a.pageNum - b.pageNum);
    return urls.map((u, index) => ({ index, imageUrl: u.url }));
  }
}
