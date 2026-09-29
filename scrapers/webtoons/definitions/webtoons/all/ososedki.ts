import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

interface AlbumsResponseDto {
  html: string;
  hasMore?: boolean;
}

const ENTRY_SELECTOR = 'article.gallery-item:has(a.gallery-link)';
const ENTRY_LINK_SELECTOR = 'a.gallery-link';
const ENTRY_TITLE_SELECTOR = 'h3';
const ENTRY_IMAGE_SELECTOR = 'img.gallery-img';
const ENTRY_AUTHOR_SELECTOR = 'span.badge:not(.bg-dark)';

const TITLE_SELECTOR = 'h1';
const AUTHOR_SELECTOR = 'a[href^=/model/]';
const COSPLAY_SELECTOR = 'a[href^=/cosplay/]';
const FANDOM_SELECTOR = 'a[href^=/fandom/]';

const PAGE_SELECTOR = '#photos a[href^=/images/], #photos a[href^=https://ososedki.com/images/]';

const ALBUM_ID_REGEX = /^-?\d+_\d+$/;
const ALBUM_ID_PARTS_REGEX = /^(-?\d+)_(\d+)$/;
const DATE_PUBLISHED_REGEX = /"datePublished":"([^"]+)"/;
const TITLE_SUFFIX_REGEX = /\s*\(\d+\s+leaked\s+photos\)\s+from\s+Onlyfans,\s+Patreon\s+and\s+Fansly\s*$/i;

const SUPPORTED_FILTER_TYPES = new Set(['model', 'cosplay', 'fandom']);

export class OsosedkiScraper extends BaseScraper {
  readonly name = 'OSOSEDKI';
  readonly baseUrl = 'https://ososedki.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getAlbums(page, 'top', '1');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getAlbums(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return this.getPopular(page);
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return this.getMangasByUrl(trimmed, page);
    }
    return this.getAlbums(page, 'search', trimmed);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const albumId = this.extractAlbumId(mangaUrl);
    if (!albumId) throw new Error(`Unable to parse album id from URL: ${mangaUrl}`);
    const response = await this.get(`${this.baseUrl}/photos/${albumId}`);
    return this.parseDetails(this.$(response.data), albumId);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const albumId = this.extractAlbumId(mangaUrl);
    if (!albumId) throw new Error(`Unable to parse album id from URL: ${mangaUrl}`);
    const response = await this.get(`${this.baseUrl}/photos/${albumId}`);
    return [
      {
        url: `/photos/${albumId}`,
        name: 'Gallery',
        chapterNumber: 0,
        dateUpload: this.parseUploadDate(response.data as string),
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const albumId = this.extractAlbumId(chapterUrl);
    if (!albumId) throw new Error(`Unable to parse album id from URL: ${chapterUrl}`);
    const response = await this.get(`${this.baseUrl}/photos/${albumId}`);
    const $ = this.$(response.data);
    const urls = $(PAGE_SELECTOR)
      .map((_, el) => this.absUrl($(el).attr('href') || ''))
      .get()
      .filter(u => u.length > 0)
      .filter((u, i, arr) => arr.indexOf(u) === i)
      .sort((a, b) => this.extractPageNumber(a) - this.extractPageNumber(b));
    return urls.map((imageUrl, index) => ({ index, imageUrl }));
  }

  async resolveImageUrl(imageUrl: string): Promise<string> {
    let status = 0;
    try {
      const res = await this.get(imageUrl, { validateStatus: () => true });
      status = res.status;
    } catch {
      return imageUrl;
    }
    if (status !== 404) return imageUrl;
    const url = new URL(imageUrl);
    const segs = url.pathname.split('/').filter(Boolean);
    if (segs.length < 3 || segs[0] !== 'images' || segs[1] !== 'a' || segs[2] !== '1280') {
      return imageUrl;
    }
    segs[2] = '604';
    url.pathname = `/${segs.join('/')}`;
    return url.toString();
  }

  private async getMangasByUrl(rawUrl: string, page: number): Promise<SearchResult> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { mangas: [], hasNextPage: false };
    }
    if (url.host.toLowerCase() !== 'ososedki.com' && url.host.toLowerCase() !== 'www.ososedki.com') {
      return { mangas: [], hasNextPage: false };
    }
    const segments = url.pathname.split('/').map(s => s.trim()).filter(Boolean);
    const photosIndex = segments.indexOf('photos');
    if (photosIndex !== -1 && photosIndex + 1 < segments.length && ALBUM_ID_REGEX.test(segments[photosIndex + 1])) {
      const albumId = segments[photosIndex + 1];
      const details = await this.getMangaDetails(`/photos/${albumId}`);
      return {
        mangas: [{ url: `/photos/${albumId}`, title: details.title || '', thumbnailUrl: details.thumbnailUrl || '', lang: this.lang, ...details }],
        hasNextPage: false,
      };
    }
    if (segments.length >= 2 && SUPPORTED_FILTER_TYPES.has(segments[0])) {
      const value = segments[1].replace(/\+/g, ' ').trim();
      if (!value) return { mangas: [], hasNextPage: false };
      return this.getAlbums(page, segments[0], value);
    }
    return { mangas: [], hasNextPage: false };
  }

  private async getAlbums(page: number, type?: string, value?: string): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/albums`);
    url.searchParams.set('page', String(page));
    if (type && value) {
      url.searchParams.set('type', type);
      url.searchParams.set('value', value);
    }
    const response = await this.get(url.toString());
    const data = response.data as AlbumsResponseDto;
    const $ = this.$(data.html || '');
    const mangas: Manga[] = [];
    $(ENTRY_SELECTOR).each((_, el) => {
      const $el = $(el);
      const href = $el.find(ENTRY_LINK_SELECTOR).first().attr('href') || '';
      const albumId = this.extractAlbumId(this.absUrl(href));
      if (!albumId) throw new Error('Unable to parse album URL from listing element');
      let title = $el.find(ENTRY_TITLE_SELECTOR).first().text().trim();
      if (!title) {
        title = ($el.find(ENTRY_IMAGE_SELECTOR).first().attr('alt') || '').split(' nude.')[0].trim();
      }
      if (!title) throw new Error(`Title is missing for album id: ${albumId}`);
      const img = $el.find(ENTRY_IMAGE_SELECTOR).first();
      const thumb = img.attr('data-src') || img.attr('src') || '';
      mangas.push({
        url: `/photos/${albumId}`,
        title,
        thumbnailUrl: thumb ? this.absUrl(thumb) : '',
        lang: this.lang,
        author: $el.find(ENTRY_AUTHOR_SELECTOR).first().text().trim() || undefined,
        status: 0,
      });
    });
    return { mangas, hasNextPage: data.hasMore === true };
  }

  private parseDetails($: CheerioAPI, albumId: string): Partial<Manga> {
    const modelTags = this.extractTags($, AUTHOR_SELECTOR);
    const cosplayTags = this.extractTags($, COSPLAY_SELECTOR);
    const fandomTags = this.extractTags($, FANDOM_SELECTOR);
    let title = [modelTags[0], cosplayTags[0], fandomTags[0]].filter((t): t is string => !!t).join(' - ');
    if (!title) {
      title = ($(TITLE_SELECTOR).first().text() || '').trim().replace(TITLE_SUFFIX_REGEX, '').trim();
    }
    if (!title) throw new Error(`Title is missing for album id: ${albumId}`);
    const tags = [...new Set([...modelTags, ...cosplayTags, ...fandomTags])];
    return {
      title,
      thumbnailUrl: this.coverFromAlbumId(albumId) || this.imgSrc($, ENTRY_IMAGE_SELECTOR) || $('meta[property=og:image]').first().attr('content') || '',
      author: modelTags.join(', ') || undefined,
      artist: cosplayTags.join(', ') || undefined,
      genre: tags.join(', ') || undefined,
      status: 0,
    };
  }

  private extractTags($: CheerioAPI, selector: string): string[] {
    const tags = $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(t => t.length > 0);
    return [...new Set(tags)];
  }

  private imgSrc($: CheerioAPI, selector: string): string | undefined {
    const el = $(selector).first();
    if (el.attr('data-src')) return this.absUrl(el.attr('data-src') || '');
    if (el.attr('src')) return this.absUrl(el.attr('src') || '');
    return undefined;
  }

  private coverFromAlbumId(albumId: string): string | undefined {
    const match = ALBUM_ID_PARTS_REGEX.exec(albumId);
    if (!match) return undefined;
    return `${this.baseUrl}/images/albums/${match[1]}/${match[2]}.webp`;
  }

  private parseUploadDate(html: string): number {
    const match = DATE_PUBLISHED_REGEX.exec(html);
    if (!match) return 0;
    const ts = Date.parse(match[1]);
    return Number.isNaN(ts) ? 0 : ts;
  }

  private extractAlbumId(pathOrUrl: string): string | undefined {
    const path = pathOrUrl.split('?')[0];
    const segments = path.split('/').map(s => s.trim()).filter(Boolean);
    const photosIndex = segments.indexOf('photos');
    const candidates = photosIndex !== -1 && photosIndex + 1 < segments.length
      ? [segments[photosIndex + 1]]
      : segments;
    return candidates.find(s => ALBUM_ID_REGEX.test(s));
  }

  private extractPageNumber(url: string): number {
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1] || '';
      const n = parseInt(last.split('.')[0], 10);
      return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }
}
