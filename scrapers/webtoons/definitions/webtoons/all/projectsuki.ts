import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const HOMEPAGE = 'https://projectsuki.com';

interface PagesRequestData {
  bookid: string;
  chapterid: string;
  first: string;
}

function imageSrc(el: any, $: cheerio.CheerioAPI): string | null {
  const variants = ['src', 'data-src', 'data-lazy-src'];
  for (const v of variants) {
    if ($(el).attr(v)) return $(el).attr(v) || null;
  }
  const srcset = $(el).attr('srcset');
  if (srcset) return srcset.split(' ')[0];
  return null;
}

function extractBooks($: cheerio.CheerioAPI): { url: string; title: string; thumbnail: string }[] {
  const books: { url: string; title: string; thumbnail: string }[] = [];
  $('a[href]').each((_: any, el: any) => {
    const href = $(el).attr('abs:href') || '';
    const match = href.match(/projectsuki\.com\/book\/(.+)/);
    if (!match) return;
    const bookUrl = href.replace(HOMEPAGE, '');
    const img = $(el).find('img').first();
    const src = imageSrc(img, $);
    const titleEl = $(el).closest('*').find('a').not(img.closest('a')).first();
    const title = titleEl.text().trim() || img.attr('alt') || '';
    if (!title) return;
    const thumb = src ? `${HOMEPAGE}${src.startsWith('/') ? '' : '/'}${src}` : `${HOMEPAGE}/images/gallery/${match[1]}/thumb`;
    if (!books.some(b => b.url === bookUrl)) {
      books.push({ url: bookUrl, title, thumbnail: thumb });
    }
  });
  return books;
}

export class ProjectSukiScraper extends BaseScraper {
  readonly name = 'Project Suki';
  readonly baseUrl = HOMEPAGE;
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/browse/${page - 1}`);
    const $ = this.$(res.data);
    const mangas = extractBooks($).map(b => ({
      url: b.url,
      title: b.title,
      thumbnailUrl: b.thumbnail,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: mangas.length >= 30 };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get('/');
    const $ = this.$(res.data);
    const mangas = extractBooks($).map(b => ({
      url: b.url,
      title: b.title,
      thumbnailUrl: b.thumbnail,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`/search?page=${page - 1}&q=${encodeURIComponent(query)}`);
    const $ = this.$(res.data);
    const mangas = extractBooks($).map(b => ({
      url: b.url,
      title: b.title,
      thumbnailUrl: b.thumbnail,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: mangas.length >= 30 };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('table').each((_: any, table: any) => {
      const thead = $(table).find('thead tr td');
      const headers: string[] = [];
      thead.each((i: number, td: any) => headers.push($(td).text().toLowerCase().trim()));
      const chapterIdx = headers.findIndex(h => /chapters?/.test(h));
      const groupIdx = headers.findIndex(h => /groups?/.test(h));
      const addedIdx = headers.findIndex(h => /added|date/.test(h));
      const langIdx = headers.findIndex(h => /language/.test(h));
      if (chapterIdx === -1 || groupIdx === -1) return;

      $(table).find('tbody tr').each((_: any, tr: any) => {
        const tds = $(tr).find('td');
        if (tds.length !== headers.length) return;
        const chapterEl = $(tds[chapterIdx]).find('a').first();
        const href = chapterEl.attr('abs:href') || '';
        if (!href) return;
        const match = href.match(/projectsuki\.com\/read\/(.+?)\/(.+?)\//);
        if (!match) return;
        const title = chapterEl.text().trim();
        const dateStr = $(tds[addedIdx]).text().trim();
        const dateUpload = this.parseDate(dateStr);
        const group = $(tds[groupIdx]).text().trim();
        const langText = langIdx !== -1 ? $(tds[langIdx]).text().trim().toLowerCase() : 'unknown';
        chapters.push({
          name: title,
          url: href.replace(HOMEPAGE, ''),
          scanlator: `${group} | ${langText.charAt(0).toUpperCase() + langText.slice(1)}`,
          dateUpload,
        });
      });
    });
    return chapters;
  }

  private parseDate(str: string): number | undefined {
    const relMatch = str.match(/^(\d+)\s+(year|month|week|day|hour|min|sec)/);
    if (relMatch) {
      const n = parseInt(relMatch[1], 10);
      const unit = relMatch[2];
      const now = Date.now();
      const ms = {
        year: 365.25 * 86400000,
        month: 30.4375 * 86400000,
        week: 7 * 86400000,
        day: 86400000,
        hour: 3600000,
        min: 60000,
        sec: 1000,
      }[unit] || 0;
      return now - n * ms;
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const match = chapterUrl.match(/read\/(.+?)\/(.+?)\//);
    if (!match) return [];
    const bookid = match[1];
    const chapterid = match[2];
    const res = await this.post('/callpage', {
      bookid, chapterid, first: 'true',
    } as PagesRequestData, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json;charset=UTF-8',
      },
    });
    const data = res.data;
    const src: string = data?.src || '';
    if (!src) return [];
    const $src = this.$(src);
    const pages: Page[] = [];
    $src('img').each((i: number, img: any) => {
      const url = $(img).attr('src') || $(img).attr('data-src') || '';
      if (url) {
        pages.push({ index: pages.length, imageUrl: url.startsWith('http') ? url : `${this.baseUrl}${url}` });
      }
    });
    return pages;
  }
}
