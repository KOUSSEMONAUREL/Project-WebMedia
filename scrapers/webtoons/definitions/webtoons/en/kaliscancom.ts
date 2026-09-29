import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

const MANGA_ID_REGEX = /\/manga\/(\d+)-/;
const CHAPTER_ID_REGEX = /chapterId\s*=\s*(\d+)/;
const NUMBER_REGEX = /\d+/;

export class KaliScanComScraper extends BaseScraper {
  readonly name = 'KaliScan';
  readonly baseUrl = 'https://kaliscan.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchMangas(page, '', 'views');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchMangas(page, '', 'updated_at');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.searchMangas(page, query, 'views');
  }

  private async searchMangas(page: number, query: string, sort: string): Promise<SearchResult> {
    const res = await this.get('/search', { params: { q: query, page: String(page), status: 'all', sort } });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.book-detailed-item').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href') || '';
      const img = $el.find('img').first();
      const dataSrc = img.attr('data-src') || '';
      if (!href) return;
      mangas.push({
        url: this.stripBase(href),
        title: link.attr('title') || link.text().trim(),
        thumbnailUrl: dataSrc ? `${this.absUrl(dataSrc)}#image-request` : '',
        lang: this.lang,
        description: $el.find('.summary').first().text().trim() || undefined,
        genre: $el.find('.genres > *').map((_: any, g: any) => $(g).text().trim()).get().join(', ') || undefined,
      });
    });
    const hasNextPage = $('.paginator > a.active + a:not([rel=next])').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.detail h1').first().text().trim();
    const thumb = $('#cover img').first().attr('data-src') || '';
    const altNames = ($('.detail h2').first().text() || '')
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(s => s && s !== title);
    let description = $('.summary .content, .summary .content ~ p').text().trim();
    if (altNames.length > 0) description += `\n\nAlt name(s): ${altNames.join(', ')}`;
    const statusText = $('.detail .meta > p > strong:contains(Status) ~ a').first().text().trim().toLowerCase();
    const status = statusText === 'ongoing' ? 1 : statusText === 'completed' ? 2 : statusText === 'on-hold' ? 3 : statusText === 'canceled' ? 3 : 0;
    return {
      title,
      author: $('.detail .meta > p > strong:contains(Authors) ~ a').map((_: any, el: any) => $(el).text().replace(/^[, ]+|[, ]+$/g, '')).get().join(', ') || undefined,
      genre: $('.detail .meta > p > strong:contains(Genres) ~ a').map((_: any, el: any) => $(el).text().replace(/^[, ]+|[, ]+$/g, '')).get().join(', ') || undefined,
      thumbnailUrl: thumb ? `${this.absUrl(thumb)}#image-request` : '',
      description: description || undefined,
      status,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const detailRes = await this.get(mangaUrl);
    const mangaId = MANGA_ID_REGEX.exec(mangaUrl)?.[1];
    if (mangaId) {
      const $detail = this.$(detailRes.data);
      const title = $detail('.detail h1').first().text().trim();
      const apiUrl = `${this.baseUrl}/service/backend/chaplist/?manga_id=${encodeURIComponent(mangaId)}&manga_name=${encodeURIComponent(title)}`;
      const apiRes = await this.get(apiUrl);
      return this.parseChapterItems(apiRes.data);
    }
    return this.parseChapterListPage(detailRes.data);
  }

  private parseChapterItems(html: string): Chapter[] {
    const $ = this.$(html);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    $('#chapter-list > li').each((_, el) => {
      const ch = this.chapterFromElement($, el);
      if (ch && !seen.has(ch.url)) { seen.add(ch.url); chapters.push(ch); }
    });
    return chapters;
  }

  private async parseChapterListPage(html: string): Promise<Chapter[]> {
    const $ = this.$(html);
    let chapters = this.parseChapterItems(html);
    const showMore = $('div#show-more-chapters > span').first();
    if (showMore.length > 0 && showMore.attr('onclick') === 'getChapters()') {
      let bookId = '';
      $('script').each((_, el) => {
        const data = $(el).html() || '';
        if (data.includes('bookId') && data.includes('bookId = ')) {
          bookId = data.split('bookId = ')[1].split(';')[0].trim();
        }
      });
      if (!bookId) throw new Error('Cannot find script');
      const apiRes = await this.get(`${this.baseUrl}/api/manga/${bookId}/chapters?source=detail`);
      const apiChapters = this.parseChapterItems(apiRes.data);
      let cutIndex = chapters.findIndex(ch => apiChapters.some(a => a.url === ch.url));
      if (cutIndex === -1) cutIndex = chapters.length;
      chapters = [...chapters.slice(0, cutIndex), ...apiChapters];
      const seen = new Set<string>();
      chapters = chapters.filter(ch => !seen.has(ch.url) && (seen.add(ch.url), true));
    }
    return chapters;
  }

  private chapterFromElement($: CheerioAPI, el: Element): Chapter | null {
    const $el = $(el);
    const rawUrl = $el.find('a').first().attr('href') || '';
    if (!rawUrl) return null;
    const abs = this.absUrl(rawUrl);
    const url = abs.startsWith(this.baseUrl) ? abs.substring(this.baseUrl.length).replace(/\/{2,}/g, '/') : abs;
    return {
      name: $el.find('.chapter-title').first().text().trim(),
      url,
      dateUpload: this.parseChapterDate($el.find('.chapter-update').first().text().trim() || undefined),
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const html: string = res.data;
    const finalUrl = (res.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl || chapterUrl;
    const mangaId = MANGA_ID_REGEX.exec(finalUrl)?.[1];
    const chapterId = CHAPTER_ID_REGEX.exec(html)?.[1];
    let pageHtml = html;
    if (mangaId && chapterId) {
      const srv = await this.get(`${this.baseUrl}/service/backend/chapterServer/?server_id=1&chapter_id=${chapterId}`);
      pageHtml = typeof srv.data === 'string' ? srv.data : String(srv.data);
    }
    if (!pageHtml.includes('var mainServer = "')) {
      const $ = this.$(pageHtml);
      const imgs = $('#chapter-images img, .chapter-image[data-src]');
      if (pageHtml.includes("var chapImages = '")) {
        const jsPaths = pageHtml.split("var chapImages = '")[1].split("'")[0].split(',');
        if (jsPaths.length > 0 && jsPaths.every(p => p.startsWith('http://') || p.startsWith('https://'))) {
          if (imgs.length < jsPaths.length) {
            return jsPaths.map((path, index) => ({ index, imageUrl: path }));
          }
        }
      }
      return imgs.map((i: number, el: any) => ({ index: i, imageUrl: this.resolveImageUrl($, el) })).get();
    }
    const mainServer = pageHtml.split('var mainServer = "')[1].split('"')[0];
    const schemePrefix = mainServer.startsWith('//') ? 'https:' : '';
    const chapImages = pageHtml.split("var chapImages = '")[1].split("'")[0].split(',');
    return chapImages.map((path, index) => ({ index, imageUrl: `${schemePrefix}${mainServer}${path}` }));
  }

  private resolveImageUrl($: CheerioAPI, el: Element): string {
    const $el = $(el);
    const dataSrc = this.absUrl($el.attr('data-src') || $el.attr('src') || '');
    const raw = ($el.attr('onerror') || '').split("this.src='")[1]?.split("'")[0] || '';
    let fallback = '';
    if (raw.startsWith('https://') || raw.startsWith('http://')) fallback = raw;
    else if (raw.startsWith('//')) fallback = `https:${raw}`;
    else return dataSrc;
    if (dataSrc.includes('://s20.')) return fallback;
    return `${dataSrc}#${fallback}`;
  }

  private parseChapterDate(date: string | undefined): number {
    if (!date) return 0;
    if (date.includes(' ago')) return this.parseRelativeDate(date);
    const ts = Date.parse(date);
    return isNaN(ts) ? 0 : ts;
  }

  private parseRelativeDate(date: string): number {
    const number = parseInt(NUMBER_REGEX.exec(date)?.[0] || '', 10) || 0;
    const now = Date.now();
    if (date.includes('year')) return now - number * 365 * 86400000;
    if (date.includes('month')) return now - number * 30 * 86400000;
    if (date.includes('day')) return now - number * 86400000;
    if (date.includes('hour')) return now - number * 3600000;
    if (date.includes('minute')) return now - number * 60000;
    if (date.includes('second')) return now - number * 1000;
    return 0;
  }

  private stripBase(href: string): string {
    const abs = this.absUrl(href);
    return abs.startsWith(this.baseUrl) ? abs.substring(this.baseUrl.length) : abs;
  }
}
