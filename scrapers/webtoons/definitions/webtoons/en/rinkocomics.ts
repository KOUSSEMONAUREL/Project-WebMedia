import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const LOCK_PREFIX = '🔒 ';
const LOCK_SUFFIX = '#lock';

function parseStatus(value: string): MangaStatus {
  switch (value.trim().toLowerCase()) {
    case 'ongoing':
      return 1;
    case 'completed':
      return 0;
    case 'hiatus':
      return undefined;
    case 'cancelled':
    case 'canceled':
      return 2;
    default:
      return undefined;
  }
}

export class RinkoComicsScraper extends BaseScraper {
  readonly name = 'Rinko Comics';
  readonly baseUrl = 'https://rinkocomics.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data as string);
    const mangas = $('.comics-flex-pinned a.pinned-comic-card').toArray().map(el => {
      const link = $(el);
      return {
        title: link.find('.pinned-comic-title').first().text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.imageFromElement(link.find('.comic-thumbnail img').first()),
        lang: this.lang,
      };
    }).filter(manga => manga.title && manga.url);
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = this.comicsUrl(page);
    url.searchParams.set('sort', 'newest');
    return this.parseComicsPage((await this.get(url.toString())).data as string);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = this.comicsUrl(page);
    url.searchParams.set('post_type', 'comic');
    if (query.trim()) url.searchParams.set('s', query.trim());
    return this.parseComicsPage((await this.get(url.toString())).data as string);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const authors = $('.comic-graph > span').toArray()
      .map(el => $(el).text().trim())
      .filter(text => text && text !== '•');
    return {
      title: $('.comic-info-upper h1, h1').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: $('meta[property=og:image]').attr('content') || undefined,
      author: authors[0],
      artist: authors[1],
      status: parseStatus($('.comic-status span:last-child').first().text()),
      genre: $('.comic-genres .genres .genre').toArray()
        .map(el => $(el).text().trim())
        .filter(Boolean)
        .join(', ') || undefined,
      description: $('.comic-synopsis').first().text().trim() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const html = res.data as string;
    const $ = this.$(html);
    const chapters = new Map<string, Chapter>();
    this.parseChapterElements($, $('li.chapter').toArray()).forEach(chapter => chapters.set(chapter.url, chapter));

    const loadMore = $('#loadMoreChaptersBtn').first();
    const comicId = (loadMore.attr('data-comic-id') || '').trim();
    const nonce = /comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/.exec(html)?.[1] || '';
    let offset = Number(loadMore.attr('data-offset') || 0);
    if (offset <= 0) {
      offset = chapters.size;
    } else if (chapters.size > 0 && offset > chapters.size) {
      offset = chapters.size;
    }

    if (comicId && nonce) {
      while (true) {
        const items = await this.fetchMoreChapters(comicId, offset, nonce);
        if (items.length === 0) break;
        let added = 0;
        for (const chapter of items) {
          if (chapters.has(chapter.url)) continue;
          chapters.set(chapter.url, chapter);
          added++;
        }
        if (added === 0) break;
        offset += 10;
      }
    }

    return [...chapters.values()];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    if (chapterUrl.endsWith(LOCK_SUFFIX)) {
      throw new Error('This chapter is locked. Use WebView to purchase it.');
    }
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const payload = $('script#cwPages').html()?.trim();
    if (!payload) return [];
    const raw = Buffer.from(payload, 'base64');
    if (raw.length <= 16) return [];
    const decoded = Buffer.alloc(raw.length - 16);
    for (let i = 0; i < decoded.length; i++) {
      decoded[i] = raw[i + 16] ^ raw[i % 16];
    }
    const urls = JSON.parse(decoded.toString('utf8')) as string[];
    return urls.map((imageUrl, index) => ({ index, imageUrl }));
  }

  private parseChapterElements($: CheerioAPI, elements: Element[]): Chapter[] {
    return elements.map((el): Chapter | null => {
      const item = $(el);
      const permalink = (item.attr('data-permalink') || '').trim();
      const href = (item.find('a').first().attr('href') || '').trim();
      const url = permalink || href;
      if (!url || url === '#') return null;
      const name = item.find('.chapter-number').first().text().trim()
        || (item.attr('data-title') || '').trim();
      const locked = this.isLocked(item, href);
      const dateText = item.find('.chapter-date').first().text().trim();
      const dateUpload = dateText ? Date.parse(dateText) : NaN;
      return {
        name: `${locked ? LOCK_PREFIX : ''}${name}`,
        url: `${this.absUrl(url)}${locked ? LOCK_SUFFIX : ''}`,
        dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
      };
    }).filter((chapter): chapter is Chapter => chapter !== null);
  }

  private async fetchMoreChapters(comicId: string, offset: number, nonce: string): Promise<Chapter[]> {
    const body = new URLSearchParams({
      action: 'load_more_chapters',
      nonce,
      comic_id: comicId,
      offset: String(offset),
    });
    const res = await this.post('/wp-admin/admin-ajax.php', body, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const data = res.data as { success?: boolean; data?: { html?: string } };
    const html = data.success ? data.data?.html : '';
    if (!html) return [];
    const $ = this.$(html);
    return this.parseChapterElements($, $('li.chapter').toArray());
  }

  private comicsUrl(page: number): URL {
    const path = page <= 1 ? '/comic/' : `/comic/page/${page}/`;
    return new URL(path, this.baseUrl);
  }

  private parseComicsPage(html: string): SearchResult {
    const $ = this.$(html);
    const mangas = $('article.ac-card').toArray().map(el => {
      const card = $(el);
      const link = card.find('.ac-title a').first();
      const title = link.text().trim();
      const url = this.absUrl(link.attr('href') || '');
      if (!title || !url) return null;
      return {
        title,
        url,
        thumbnailUrl: this.imageFromElement(card.find('.ac-thumb img').first()),
        lang: this.lang,
      };
    }).filter((manga): manga is Manga => manga !== null);
    return { mangas, hasNextPage: $('.ac-pagination a.next').length > 0 };
  }

  private isLocked(item: ReturnType<CheerioAPI>, href: string): boolean {
    const reason = (item.attr('data-reason') || '').toLowerCase();
    if (reason && reason !== 'free') return true;
    if (item.hasClass('locked-chapter')) return true;
    if (!href || href === '#') return true;
    return item.find('.chapter_price').length > 0;
  }

  private imageFromElement(image: ReturnType<CheerioAPI>): string {
    const dataSrc = image.attr('data-src');
    if (dataSrc) return this.absUrl(dataSrc);
    const lazySrc = image.attr('data-lazy-src');
    if (lazySrc) return this.absUrl(lazySrc);
    const src = image.attr('src');
    return src ? this.absUrl(src) : '';
  }
}

export default RinkoComicsScraper;
