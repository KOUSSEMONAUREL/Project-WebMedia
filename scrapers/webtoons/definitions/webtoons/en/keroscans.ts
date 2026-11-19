import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Manga, MangaStatus, Chapter, Page, SearchResult } from '../../../engine/types';

const HIDE_LOCKED = true;

export class KeroscansScraper extends BaseScraper {
  readonly name = 'Keroscans';
  readonly baseUrl = 'https://keroscans.net';
  readonly lang = 'en';

  private statusToManga(status: string): MangaStatus {
    switch (status) {
      case 'Ongoing': return 1;
      case 'Completed': return 0;
      case 'Hiatus': return 3;
      case 'Cancelled': return 2;
      default: return 3;
    }
  }

  private parseMangas($: CheerioAPI): Manga[] {
    return $('article')
      .toArray()
      .map(element => {
        const article = $(element);
        const link = article.find('a').first();
        const cover = link.find('.ks-cover').first();
        const href = link.attr('href') ?? '';
        const title = link.find('h3').first().text().trim();
        if (!href || !title) return undefined;
        const badges = cover.find('span.ks-badge--overlay').toArray();
        const status = badges.length > 0
          ? $(badges[badges.length - 1]).text().trim()
          : '';
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(cover.find('img').first().attr('src') ?? ''),
          lang: this.lang,
          status: this.statusToManga(status),
        } as Manga;
      })
      .filter((manga): manga is Manga => Boolean(manga));
  }

  private async getMangasPage(pageUrl: string): Promise<SearchResult> {
    const res = await this.get(pageUrl);
    const $ = this.$(String(res.data));
    return {
      mangas: this.parseMangas($),
      hasNextPage: $('nav[aria-label="Pagination"] a[rel="next"]').length > 0,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getMangasPage(`${this.baseUrl}/series?sort=popular&page=${page}`);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getMangasPage(`${this.baseUrl}/series?sort=latest&page=${page}`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/series`);
    if (query.trim().length >= 3) {
      url.pathname = '/search';
      url.searchParams.set('q', query.trim());
    }
    url.searchParams.set('page', String(page));
    return this.getMangasPage(url.toString());
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const details = this.readDetails($);
    const title = $('#series-title').first().text().trim();

    const genres: string[] = [];
    for (const key of ['Type', 'Language', 'Demographic']) {
      const value = details.get(key);
      if (value) genres.push(value);
    }
    $('ul[aria-label="Genres"] li').each((_: number, el) => {
      const value = $(el).text().trim();
      if (value) genres.push(value);
    });
    $('ul[aria-label="Tags"] li').each((_: number, el) => {
      const value = $(el).text().replace(/^#/, '').trim();
      if (value) genres.push(value);
    });

    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('section[aria-label="Cover"] img').first().attr('src') ?? ''),
      author: details.get('Author'),
      artist: details.get('Artist'),
      status: this.statusToManga(details.get('Status') ?? ''),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: $('.ks-sp__summary').first().text().trim() || undefined,
      lang: this.lang,
    };
  }

  private readDetails($: CheerioAPI): Map<string, string> {
    const details = new Map<string, string>();
    $('aside[aria-label="Series details"] dl div').each((_: number, el) => {
      const row = $(el);
      const name = row.find('dt').first().text().trim();
      const value = row.find('dd').first().text().trim();
      if (name) details.set(name, value);
    });
    return details;
  }

  private chapterFromElement($: CheerioAPI, element: Element): Chapter | undefined {
    const item = $(element);
    const anchor = item.find('a').first();
    const href = anchor.attr('href') ?? '';
    const number = anchor.attr('data-chapter-number');
    if (!href) return undefined;
    const date = item.find('time').attr('datetime');
    const dateUpload = date ? Date.parse(date) : Number.NaN;
    const locked = item.attr('data-access') === 'paid';
    return {
      name: `${locked ? '\u{1F512} ' : ''}Chapter ${number ?? ''}`.trim(),
      url: this.absUrl(href),
      chapterNumber: number ? Number.parseFloat(number) : undefined,
      dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const manga = new URL(this.absUrl(mangaUrl));
    const slug = manga.pathname.split('/').filter(Boolean).pop() ?? '';
    const res = await this.get(manga.toString());
    const $ = this.$(String(res.data));

    const selector = HIDE_LOCKED
      ? '#chapter-list ol li[data-access="free"]'
      : '#chapter-list ol li';
    const chapters: Chapter[] = [];
    $(selector).each((_: number, el) => {
      const chapter = this.chapterFromElement($, el);
      if (chapter) chapters.push(chapter);
    });

    if ($('#chapter-list div[data-chapter-more-wrap]').length === 0) return chapters;

    for (let page = 2; page <= 200; page++) {
      const pageUrl = new URL(manga.toString());
      pageUrl.searchParams.set('page', String(page));
      pageUrl.searchParams.set('partial', 'chapters');
      const pageRes = await this.get(pageUrl.toString());
      const fragment = this.$(String(pageRes.data));
      const found: Chapter[] = [];
      fragment(selector).each((_: number, el) => {
        const chapter = this.chapterFromElement(fragment, el);
        if (chapter) found.push(chapter);
      });
      chapters.push(...found);
      if (fragment('#chapter-list div[data-chapter-more-wrap]').length === 0) break;
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    const pages: Page[] = [];
    $('ol.ks-pages li.ks-page img').each((index: number, el) => {
      const src = $(el).attr('src');
      if (src) pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }
}
