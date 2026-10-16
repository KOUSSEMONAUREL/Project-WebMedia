import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

export class AsmotoonScraper extends BaseScraper {
  readonly name = 'Asmodeus Scans';
  readonly baseUrl = 'https://asmotoon.com';
  readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/?_ajax=search&sort=popular&offset=0`;
    const res = await this.get(url);
    const body = res.data as { html?: string; has_more?: boolean };
    const $ = this.$(body.html ?? '');
    const mangas: Manga[] = $('a.group[href]').toArray().map(el => {
      const $el = $(el);
      const link = $el;
      const title = $el.find('h2').first().text().trim();
      const thumbnailUrl = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || '';
      return {
        title,
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(thumbnailUrl),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: body.has_more === true };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/?_ajax=recent-chapters&page=1`;
    const res = await this.get(url);
    const body = res.data as string;
    const $ = this.$(body);
    const mangas: Manga[] = [];
    $('article.ru-card').each((_i, el) => {
      const $el = $(el);
      const link = $el.find('h2.ru-title > a').first();
      const href = link.attr('href');
      if (!href) return;
      const title = link.text().trim();
      const thumbnailUrl = $el.find('img.ru-cover-img').first().attr('data-src') || '';
      mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumbnailUrl), lang: this.lang });
    });
    const hasNextPage = $('button[aria-label="Next recently updated page"]:not([disabled])').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const offset = 0;
    const url = `${this.baseUrl}/?_ajax=search&q=${encodeURIComponent(query)}&offset=${offset}`;
    const res = await this.get(url);
    const body = res.data as { html?: string; has_more?: boolean };
    const $ = this.$(body.html ?? '');
    const mangas: Manga[] = $('a.group[href]').toArray()
      .map(el => {
        const $el = $(el);
        const title = $el.find('h2').first().text().trim();
        const thumbnailUrl = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || '';
        return {
          title,
          url: this.absUrl($el.attr('href') || ''),
          thumbnailUrl: this.absUrl(thumbnailUrl),
          lang: this.lang,
        };
      })
      .filter(m => m.title.toLowerCase().includes(query.toLowerCase()));
    return { mangas, hasNextPage: body.has_more === true };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const dataSeriesUid = $('[data-series-uid]').first().attr('data-series-slug') || mangaUrl.replace(/\/+$/, '').split('/').pop() || '';
    void dataSeriesUid;
    const title = $('h1').first().text().trim();
    const description = $('#series-desc').text().trim() || undefined;
    const thumbnailUrl = $('meta[property="og:image"]').attr('content') || '';
    const genre = $('a[href*="?browse&tag"]').toArray().map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined;
    let author: string | undefined;
    let artist: string | undefined;
    const meta = (label: string): string | undefined => {
      const el = $('span.text-xs').filter((_i, e) => $(e).text().trim() === label).first();
      if (!el.length) return undefined;
      const parent = el.parent();
      const next = parent.next();
      const val = next.text().trim();
      return val || undefined;
    };
    author = meta('Author');
    artist = meta('Artist');
    let statusText = '';
    $('div.text-xs').each((_i, el) => {
      if ($(el).text().trim() === 'Status') {
        statusText = $(el).parent().next().find('span.text-sm').first().text().trim().toLowerCase();
      }
    });
    let status: Manga['status'] = 0;
    if (statusText === 'ongoing') status = 1;
    else if (statusText === 'completed') status = 2;
    else if (statusText === 'dropped') status = 3;

    return {
      title: title || undefined,
      url: mangaUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      description,
      genre,
      author,
      artist,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace(/\/+$/, '').split('/').pop() || '';
    const url = `${this.baseUrl}/?_chapters_html=1&series_slug=${encodeURIComponent(slug)}`;
    const res = await this.get(url);
    const body = res.data as { rows_html?: string };
    const $ = this.$(body.rows_html ?? '');
    const chapters: Chapter[] = [];
    $('a.chapter-row[href]').each((_i, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      if (!href) return;
      const label = $el.attr('data-ch-label') || $el.text().trim();
      const locked = $el.attr('data-ch-locked') === '1';
      const name = locked ? `🔒 ${label}` : label;
      const dateText = $el.find('.ch-date-row span:last-child').text().trim();
      let dateUpload: number | undefined;
      const ts = Date.parse(dateText);
      if (!Number.isNaN(ts)) dateUpload = ts;
      chapters.push({ name, url: this.absUrl(href), dateUpload });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const pages: Page[] = [];
    $('#strip-reader img.reader-page').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src) pages.push({ index: i, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  protected $ (html: string): CheerioAPI {
    return super.$(html);
  }
}
