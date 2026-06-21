import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.122 Safari/537.36';
const UNICODE_REGEX = /\\u([0-9A-Fa-f]{4})|\\U([0-9A-Fa-f]{8})/g;
const ESCAPE_CHAR_REGEX = /(\\n)|(\\r)|(\\{1})/g;

interface SearchDto {
  webtoon: { sHtml: string };
}

export class ToomicsGlobalScraper extends BaseScraper {
  readonly name = 'Toomics (Only free chapters)';
  readonly baseUrl = 'https://global.toomics.com';
  readonly lang = 'all';
  private readonly siteLang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(`/${this.siteLang}/webtoon/ranking`, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${this.baseUrl}/${this.siteLang}` },
    });
    return this.parseMangaList(res);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const res = await this.get(`/${this.siteLang}/webtoon/new_comics`, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${this.baseUrl}/${this.siteLang}` },
    });
    return this.parseMangaList(res);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.post(
      `/${this.siteLang}/webtoon/ajax_search`,
      new URLSearchParams({ toonData: query }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Referer: `${this.baseUrl}/${this.siteLang}`,
        },
      },
    );
    const body: SearchDto = res.data;
    const cleanHtml = body.webtoon.sHtml.replace(UNICODE_REGEX, (_m: string, p1: string, p2: string) => {
      const hex = p1 || p2;
      return String.fromCharCode(parseInt(hex, 16));
    }).replace(ESCAPE_CHAR_REGEX, '');
    const $ = this.$(cleanHtml);
    const mangas: Manga[] = [];
    $('#search-list-items li').each((_: any, el: any) => {
      const title = $(el).find('strong').first().text().trim();
      const anchor = $(el).find('a.relative').first();
      const img = $(el).find('img').first();
      if (!title || !anchor) return;
      const href = anchor.attr('href') || '';
      const toonMatch = href.match(/Base\.setFamilyMode\('N', '([^']+)'\)/);
      let toonUrl = toonMatch?.[1] || '';
      if (toonUrl && !toonUrl.startsWith('http')) {
        toonUrl = `${this.baseUrl}/${decodeURIComponent(toonUrl)}`;
      }
      const toonParam = new URLSearchParams(new URL(toonUrl).search).get('toon');
      if (!toonParam) return;
      mangas.push({
        url: `/${this.siteLang}/webtoon/episode/toon/${toonParam}/search/Y`,
        title,
        thumbnailUrl: img.attr('src') || '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  private parseMangaList(res: any): SearchResult {
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('li > div.visual a:has(img)').each((_: any, el: any) => {
      const titleEl = $(el).find('h4[class$=title]').first();
      const title = titleEl.text().trim();
      if (!title) return;
      const img = $(el).find('img').first();
      const thumb = img.attr('data-original') || img.attr('src') || '';
      const href = $(el).attr('href') || '';
      mangas.push({
        url: `${href}/search/Y`,
        title,
        thumbnailUrl: thumb,
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${this.baseUrl}/${this.siteLang}` },
    });
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('li.normal_ep:has(.coin-type1, .coin-type6)').each((_: any, el: any) => {
      const num = $(el).find('div.cell-num').first().text().trim();
      const title = $(el).find('div.cell-title strong').first().text().trim();
      const onclick = $(el).find('a').first().attr('onclick') || '';
      const href = onclick.match(/href='([^']+)'/)?.[1];
      if (!href) return;
      const time = $(el).find('div.cell-time time').first().text().trim();
      chapters.push({
        name: `${num ? num + ' - ' : ''}${title}`,
        url: `${mangaUrl.replace(/\/search\/Y$/, '')}${href}`,
        chapterNumber: parseFloat(num) || -1,
        scanlator: 'Toomics',
        dateUpload: time ? this.parseDate(time) : undefined,
      });
    });
    return chapters.reverse();
  }

  private parseDate(str: string): number | undefined {
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl, {
      headers: { 'User-Agent': USER_AGENT, Referer: `${this.baseUrl}/${this.siteLang}` },
    });
    const $ = this.$(res.data);
    if ($('div.section_age_verif').length > 0) {
      throw new Error('Verify age via WebView');
    }
    const ogUrl = $('head meta[property="og:url"]').attr('content') || '';
    const pages: Page[] = [];
    $('div[id^=load_image_] img').each((i: number, el: any) => {
      pages.push({ index: i, imageUrl: $(el).attr('data-src') || '' });
    });
    return pages;
  }
}
