import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

interface PopularPostDto {
  title: { rendered: string };
  link: string;
  embedded?: {
    featuredMedia?: Array<{ sourceUrl: string }>;
  };
}

interface CategoryMap {
  [tag: string]: string;
}

const DATE_FORMAT = 'yyyy-MM-dd';
const TAG_PATTERN = /\/(tag|category)\//;
const CATEGORIES: CategoryMap = {};

export class CosplayTeleScraper extends BaseScraper {
  readonly name = 'CosplayTele';
  readonly baseUrl = 'https://cosplaytele.com';
  readonly lang = 'all';

  private readonly popularPageLimit = 20;
  private categories: CategoryMap = { ...CATEGORIES };

  private getHeaders() {
    return { Referer: `${this.baseUrl}/` };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const offset = page * this.popularPageLimit;
    const url = `${this.baseUrl}/wp-json/wordpress-popular-posts/v1/popular-posts?offset=${offset}&limit=${this.popularPageLimit}&range=last7days&embed=true&_embed=wp:featuredmedia&_fields=title,link,_embedded,_links.wp:featuredmedia`;
    const res = await this.get(url, { headers: this.getHeaders() });
    const result: PopularPostDto[] = res.data;
    const mangas: Manga[] = result.map(item => ({
      title: item.title.rendered,
      url: this.absUrl(item.link),
      thumbnailUrl: item.embedded?.featuredMedia?.[0]?.sourceUrl || '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: mangas.length >= this.popularPageLimit };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/page/${page}/`, { headers: this.getHeaders() });
    return this.searchMangaParse(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('http')) {
      try {
        const parsedUrl = new URL(query);
        if (parsedUrl.host === 'cosplaytele.com' || parsedUrl.host === 'www.cosplaytele.com') {
          const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
          if (pathSegments.length === 0) {
            return { mangas: [], hasNextPage: false };
          }
          if (pathSegments[0] === 'category' || pathSegments[0] === 'tag') {
            const pageIndex = parsedUrl.pathname.split('/').indexOf('page');
            let paginatedUrl: string;
            if (pageIndex !== -1) {
              const segments = parsedUrl.pathname.split('/');
              segments[pageIndex + 1] = page.toString();
              paginatedUrl = `${parsedUrl.origin}${segments.join('/')}`;
            } else {
              paginatedUrl = `${query.replace(/\/$/, '')}/page/${page}`;
            }
            const res = await this.get(paginatedUrl, { headers: this.getHeaders() });
            return this.searchMangaParse(res.data);
          } else {
            const res = await this.get(query, { headers: this.getHeaders() });
            return this.mangaDetailsParse(res.data, query);
          }
        }
      } catch (err) {
        console.error(`Failed to process URL-based search on ${this.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const categoryFilter = ''; // Simplified: no filter support
    let searchUrl: string;
    if (query) {
      searchUrl = `${this.baseUrl}/page/${page}/?s=${encodeURIComponent(query)}`;
    } else {
      return this.getLatest(page);
    }
    const res = await this.get(searchUrl, { headers: this.getHeaders() });
    return this.searchMangaParse(res.data);
  }

  private searchMangaParse(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('main div.box').toArray().map(el => {
      const $el = $(el);
      const img = $el.find('img').first();
      const thumbnailUrl = this.absUrl(img.attr('src') || '');
      const linkEl = $el.find('h5 a').first();
      if (!linkEl.length) throw new Error('Title is mandatory');
      const title = linkEl.text();
      const url = this.absUrl(linkEl.attr('href') || '');
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('.next.page-number').length > 0;
    return { mangas, hasNextPage };
  }

  private mangaDetailsParse(html: string, url: string): SearchResult {
    const $ = this.$(html);
    const title = $('.entry-title').first().text();
    if (!title) throw new Error('Title is mandatory');
    const manga: Manga = {
      title,
      url,
      thumbnailUrl: '',
      description: title,
      lang: this.lang,
    };
    return { mangas: [manga], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl, { headers: this.getHeaders() });
    const $ = this.$(res.data);
    const title = $('.entry-title').first().text() || '';
    const tags = this.getTags($);
    return {
      title,
      url: mangaUrl,
      description: title || undefined,
      lang: this.lang,
    };
  }

  private getTags($: CheerioAPI): string[] {
    return $('#main a').toArray().filter(a => {
      const href = $(a).attr('href') || '';
      return TAG_PATTERN.test(href);
    }).map(a => {
      const tag = $(a).text();
      if (tag) {
        const link = $(a).attr('href') || '';
        const path = link.replace(this.baseUrl, '').replace(/^\//, '');
        this.categories[tag] = path;
      }
      return tag;
    });
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const path = new URL(mangaUrl).pathname;
    const res = await this.get(mangaUrl, { headers: this.getHeaders() });
    const $ = this.$(res.data);
    const dateText = $('time.updated').attr('datetime') || '';
    let dateUpload: number | undefined;
    if (dateText) {
      const dateStr = dateText.split('T')[0];
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) dateUpload = d.getTime();
    }
    return [{
      name: 'Gallery',
      url: path,
      dateUpload,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${this.baseUrl}${chapterUrl}`, { headers: this.getHeaders() });
    const $ = this.$(res.data);
    return $('.gallery-item img').toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}
