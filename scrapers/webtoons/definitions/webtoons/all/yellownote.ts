import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const MANGA_SELECTOR = 'a[href^=/photo/]:has(> span.ph), a[href^=/amateur/]:has(> span.ph)';
const DATE_REGEX = /\d{4}-\d{2}-\d{2}/;
const MEDIA_COUNT_REGEX = /\d+P( \+ \d+V)?/;

export class YellowNoteScraper extends BaseScraper {
  readonly name = 'YellowNote';
  readonly baseUrl = 'https://en.xchina.co';
  readonly lang = 'all';

  private parseMangaList($: CheerioAPI): SearchResult {
    const mangas = $('main')
      .find(MANGA_SELECTOR)
      .toArray()
      .map(element => {
        const link = $(element);
        const href = link.attr('href') ?? '';
        const title = link.find('> span.ph + span').text().trim();
        if (!href || !title) return undefined;
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(link.find('> span.ph > img').attr('src') ?? ''),
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => Boolean(manga));

    return {
      mangas,
      hasNextPage: $('a[rel=next]').length > 0,
    };
  }

  private listUrl(path: string, page: number): string {
    const suffix = page > 1 ? `/${page}` : '';
    return `${this.baseUrl}/${path}${suffix}`;
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl('photos', 1));
    const $ = this.$(String(res.data));
    const section = $('main section').first();
    const mangas = section
      .find(MANGA_SELECTOR)
      .toArray()
      .map(element => {
        const link = $(element);
        const href = link.attr('href') ?? '';
        const title = link.find('> span.ph + span').text().trim();
        if (!href || !title) return undefined;
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(link.find('> span.ph > img').attr('src') ?? ''),
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => Boolean(manga));
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.parseMangaList(this.$(String((await this.get(this.listUrl('photos/new', page))).data)));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', term);
    url.searchParams.set('type', 'photo');
    if (page > 1) url.searchParams.set('page', String(page));
    return this.parseMangaList(this.$(String((await this.get(url.toString())).data)));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const header = $('main header').first();

    const genres = header
      .find('a[href^=/photo-series/]:not([href*=?]), a[href*=?filter=], a[href^=/photos/tag/]')
      .toArray()
      .map(element => $(element).text().trim().replace(/^#/, ''))
      .filter(Boolean);

    const mediaCount = header
      .find('span')
      .toArray()
      .map(element => $(element).text().trim())
      .find(text => MEDIA_COUNT_REGEX.test(text));

    return {
      title: header.find('h1').first().text().trim(),
      url: mangaUrl,
      author: header
        .find('a[href^=/model/], a[href^=/user-amateurs/]')
        .toArray()
        .map(element => $(element).text().trim())
        .filter(Boolean)
        .join(', ') || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      description: mediaCount,
      thumbnailUrl: $('meta[property=og:image]').attr('content') || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  private pageCount($: CheerioAPI, path: string): number {
    const total = $('form[data-page-jump]').attr('data-total');
    if (total) {
      const parsed = Number.parseInt(total, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    const prefix = `${path}/`;
    let max = 1;
    $('a[href]').each((_: number, el) => {
      const href = $(el).attr('href') ?? '';
      if (!href.startsWith(prefix)) return;
      const value = Number.parseInt(href.slice(prefix.length), 10);
      if (Number.isFinite(value) && value > max) max = value;
    });
    return max;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const html = String(res.data);
    const $ = this.$(html);
    const path = new URL(this.absUrl(mangaUrl)).pathname;
    const header = $('main header').first();

    const uploadText = (header.find('details li').first().length > 0
      ? header.find('details li').first()
      : header).text();
    const dateMatch = uploadText.match(DATE_REGEX);
    const dateUpload = dateMatch ? Date.parse(dateMatch[0]) : Number.NaN;

    const count = this.pageCount($, path);
    const chapters: Chapter[] = [];
    for (let page = count; page >= 1; page--) {
      chapters.push({
        name: `Page ${page}`,
        url: page === 1 ? path : `${path}/${page}`,
        chapterNumber: page,
        dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    let res = await this.get(chapterUrl);
    // The site can redirect a later page to the set's first page, with ?go=
    // naming the page that was asked for.
    let landing = this.responseUrl(res, chapterUrl);
    const go = landing.searchParams.get('go');
    if (go) {
      const target = new URL(go, landing);
      res = await this.get(target.toString());
      landing = this.responseUrl(res, target.toString());
      if (landing.searchParams.get('go')) {
        throw new Error('Page not available, open it in WebView');
      }
    }

    const $ = this.$(String(res.data));
    const pages: Page[] = [];
    $('div[data-cols-grid] > a > img').each((index: number, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      pages.push({
        index,
        imageUrl: this.absUrl(src.replace('_600x0.webp', '.jpg')),
      });
    });
    return pages;
  }

  private responseUrl(res: { request?: unknown }, fallback: string): URL {
    const responseUrl = (res.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl;
    return new URL(responseUrl ?? this.absUrl(fallback));
  }
}
