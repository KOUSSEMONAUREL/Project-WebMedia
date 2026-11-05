import type { Cheerio, CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const STATUSES: Record<string, MangaStatus> = {
  ongoing: 1,
  completed: 0,
  hiatus: 3,
  cancelled: 2,
};

function parseStatus(status: string | null | undefined): MangaStatus {
  return status ? STATUSES[status.trim().toLowerCase()] ?? 3 : 3;
}

export class MangastashScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor() {
    super();
    this.name = 'Mangastash';
    this.baseUrl = 'https://mangastash.org';
    this.lang = 'en';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse('popular-month', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse('latest', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query });
    if (page > 1) params.set('page', String(page));
    const res = await this.get(`${this.baseUrl}/search?${params.toString()}`);
    return this.parseMangas(String(res.data), 'a.search-result-row');
  }

  private async browse(sort: string, page: number): Promise<SearchResult> {
    const params = new URLSearchParams({ sort });
    if (page > 1) params.set('page', String(page));
    const res = await this.get(`${this.baseUrl}/browse/?${params.toString()}`);
    return this.parseMangas(String(res.data), '.series-grid a.series-card');
  }

  private parseMangas(html: string, selector: string): SearchResult {
    const $ = this.$(html);
    const mangas = $(selector).toArray().map(el => this.cardToManga($, $(el)));
    const hasNextPage = $('.pagination a.page-next, a.page-next').length > 0;
    return { mangas, hasNextPage };
  }

  private cardToManga($: CheerioAPI, $el: Cheerio<any>): Manga {
    const href = this.absUrl($el.attr('href') ?? '');
    const badge = $el.find('.badge').toArray()
      .map(el => $(el).text().trim())
      .find(text => text.toLowerCase() in STATUSES);
    return {
      title: $el.find('h3').first().text().trim(),
      url: href,
      thumbnailUrl: this.coverUrl($el.find('img').first().attr('src') ?? ''),
      lang: this.lang,
      status: parseStatus(badge),
    };
  }

  private coverUrl(src: string): string {
    const absolute = this.absUrl(src);
    if (!absolute) return '';
    try {
      const url = new URL(absolute);
      const segments = url.pathname.split('/').filter(Boolean);
      const index = segments.indexOf('thumbnails');
      if (index >= 0) {
        segments.splice(index, 1);
        url.pathname = `/${segments.join('/')}`;
      }
      return url.toString();
    } catch {
      return absolute;
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const page = $('.series-page').first();
    if (page.length === 0) return {};

    const credits = page.find('.series-author').first().text().trim().split(' · ');
    const author = credits.find(text => text.startsWith('by '))?.slice(3).trim();
    const artist = credits.find(text => text.startsWith('Art by '))?.slice(7).trim();
    const badges = page.find('.series-badges .badge:not(.lang-badge)').toArray()
      .map(el => $(el).text().trim());
    const status = badges.find(text => text.toLowerCase() in STATUSES);
    const genres = page.find('.series-tags .tag-group a.tag-chip').toArray()
      .map(el => $(el).text().trim())
      .filter(Boolean);
    const altTitle = page.find('.series-title-romaji').first().text().trim();
    const description = page.find('.series-description').first().text().trim();

    return {
      title: page.find('.series-meta h1').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: this.coverUrl(page.find('.series-cover img').first().attr('src') ?? ''),
      lang: this.lang,
      author: author || undefined,
      artist: artist || undefined,
      status: parseStatus(status),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: [
        description,
        altTitle ? `Alternative title: ${altTitle}` : '',
      ].filter(Boolean).join('\n\n') || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const chapters = $('#chapter-list a.chapter-row').toArray().map(el => {
      const $el = $(el);
      const number = $el.find('.chapter-num').first().text().trim();
      const title = $el.find('.chapter-title').first().text().trim();
      const chapterNumber = Number.parseFloat($el.attr('data-num') ?? '');
      return {
        name: title ? `${number} - ${title}` : number,
        url: this.absUrl($el.attr('href') ?? ''),
        chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : undefined,
      } satisfies Chapter;
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    return $('#reader-pages .reader-page img[data-src]').toArray()
      .map((el, index) => ({
        index,
        imageUrl: this.absUrl($(el).attr('data-src') ?? ''),
      }));
  }
}
