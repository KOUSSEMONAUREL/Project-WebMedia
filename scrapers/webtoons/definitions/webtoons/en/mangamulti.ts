import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const SITE_LANG = 'en';
const SERIES_SELECTOR = '.series-card a.series-card-link';
const CHAPTER_SELECTOR = 'article.chapter-item a.chapter-link';

interface LoadMoreData {
  html?: string;
  has_more?: boolean;
}

interface LoadMoreResponse {
  data?: LoadMoreData;
}

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

export class MangaMultiScraper extends BaseScraper {
  readonly name = 'Manga Multi';
  readonly baseUrl = 'https://www.mangamulti.com';
  readonly lang = SITE_LANG;

  private listingUrl(): string {
    return `${this.baseUrl}/${SITE_LANG}/`;
  }

  private originalSize(url: string): string {
    return url.replace(/-\d+x\d+(?=\.\w+$)/, '');
  }

  private parseSeries($: CheerioAPI): Manga[] {
    return $(SERIES_SELECTOR)
      .toArray()
      .map(element => {
        const link = $(element);
        const href = link.attr('href') ?? '';
        const title = link.find('.series-card-title').first().text().trim();
        if (!href || !title) return undefined;
        const style = link.find('.series-card-thumb').first().attr('style') ?? '';
        const cover = /url\('([^']+)'\)/.exec(style)?.[1] ?? '';
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: cover ? this.originalSize(cover) : '',
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => Boolean(manga));
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.listingUrl());
    return { mangas: this.parseSeries(this.$(String(res.data))), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular();
    const params = new URLSearchParams({ s: term, lang: SITE_LANG });
    const res = await this.get(`${this.baseUrl}/${SITE_LANG}/?${params.toString()}`);
    const $ = this.$(String(res.data));
    return {
      mangas: this.parseSeries($),
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const title = $('h1.series-title').first().text().trim();
    const thumbnail = $('.series-header-thumbnail img').first().attr('src') ?? '';

    return {
      title: title || undefined,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: thumbnail ? this.originalSize(this.absUrl(thumbnail)) : undefined,
      description: $('.series-description').first().text().trim() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.absUrl(mangaUrl);
    const res = await this.get(url);
    const $ = this.$(String(res.data));
    const chapters = this.parseChapters($);

    const button = $('#load-more-series').first();
    if (button.length > 0) {
      const nonce = this.readNonce($);
      const category = button.attr('data-category') ?? '';
      let page = 2;
      let hasMore = true;

      while (hasMore && nonce) {
        const body = new URLSearchParams({
          action: 'mangaverse_load_more',
          nonce,
          lang: SITE_LANG,
          type: 'series',
          page: String(page++),
          category_id: category,
          order: 'desc',
        });
        const moreRes = await this.post('/wp-admin/admin-ajax.php', body, {
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer: url,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });
        const data = parseJson<LoadMoreResponse>(moreRes.data).data;
        chapters.push(...this.parseChapters(this.$(data?.html ?? '')));
        hasMore = Boolean(data?.has_more);
      }
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    return $('.entry-content figure > img')
      .toArray()
      .map(element => {
        const image = $(element);
        return this.absUrl(image.attr('data-src') || image.attr('src') || '');
      })
      .filter(Boolean)
      .map((imageUrl, index) => ({ index, imageUrl }));
  }

  private parseChapters($: CheerioAPI): Chapter[] {
    return $(CHAPTER_SELECTOR)
      .toArray()
      .map(element => {
        const link = $(element);
        const href = link.attr('href') ?? '';
        const name = link.find('.chapter-title').first().text().trim();
        if (!href || !name) return undefined;
        return {
          name,
          url: this.absUrl(href),
        } as Chapter;
      })
      .filter((chapter): chapter is Chapter => Boolean(chapter));
  }

  private readNonce($: CheerioAPI): string {
    const script = $('script#mangaverse-load-more-js-extra').first().text();
    const start = script.indexOf('var mangaverse_ajax = ');
    if (start < 0) return '';
    const json = script.slice(start + 'var mangaverse_ajax = '.length).split(';')[0].trim();
    if (!json) return '';
    try {
      const parsed = JSON.parse(json) as { nonce?: string };
      return parsed.nonce ?? '';
    } catch {
      return '';
    }
  }
}
