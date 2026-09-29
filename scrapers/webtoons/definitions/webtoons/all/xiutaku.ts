import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const MOBILE_HEADERS = { 'User-Agent': MOBILE_UA };

function parseXiutakuDate(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2}) (\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value.replace('🕒', '').trim());
  if (!match) return undefined;
  const [, hh, mm, d, mo, y] = match.map(Number);
  return Date.UTC(y, mo - 1, d, hh, mm);
}

export class XiutakuScraper extends BaseScraper {
  readonly name = 'Xiutaku';
  readonly baseUrl = 'https://xiutaku.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/hot?start=${20 * (page - 1)}`, { headers: MOBILE_HEADERS });
    return this.parseMangasPage(response.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/?start=${20 * (page - 1)}`, { headers: MOBILE_HEADERS });
    return this.parseMangasPage(response.data);
  }

  private parseMangasPage(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.blog > div').each((_, el) => {
      const $el = $(el);
      const link = $el.find('.item-content .item-link').first();
      if (!link.length) return;
      const href = this.absUrl(link.attr('href') || '');
      if (!href) return;
      mangas.push({
        url: href.startsWith(this.baseUrl) ? href.slice(this.baseUrl.length) : href,
        title: link.text().trim(),
        thumbnailUrl: this.absUrl($el.find('img').first().attr('src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('.pagination-next:not([disabled])').length > 0 };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('http://') || query.startsWith('https://')) {
      const url = new URL(query);
      if (url.host !== 'xiutaku.com') {
        throw new Error('Xiutaku: unsupported url');
      }
      const response = await this.get(query, { headers: MOBILE_HEADERS });
      const $ = this.$(response.data);
      if ($('.article-header').length > 0) {
        const details = await this.getMangaDetails(url.pathname);
        const thumb = $('.article-fulltext img').first().attr('src') || '';
        return {
          mangas: [{
            url: url.pathname,
            title: details.title || '',
            thumbnailUrl: thumb ? this.absUrl(thumb) : '',
            lang: this.lang,
            ...details,
          }],
          hasNextPage: false,
        };
      }
      return this.parseMangasPage(response.data);
    }
    const url = new URL(this.baseUrl);
    url.searchParams.set('search', query);
    url.searchParams.set('start', String(20 * (page - 1)));
    const response = await this.get(url.toString(), { headers: MOBILE_HEADERS });
    return this.parseMangasPage(response.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl, { headers: MOBILE_HEADERS });
    const $ = this.$(response.data);
    const title = $('.article-header').first().text().trim();
    if (!title) {
      throw new Error('Xiutaku: title is mandatory');
    }
    const description = $('.article-info')
      .toArray()
      .filter(el => $(el).find('small').length === 0)
      .map(el => $(el).text().trim())
      .find(Boolean) || undefined;
    const genre = $('.article-tags .tags > .tag')
      .toArray()
      .map(el => $(el).text().trim().replace(/^#+/, ''))
      .filter(Boolean)
      .join(', ') || undefined;
    return { title, description, genre, status: 2 };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl, { headers: MOBILE_HEADERS });
    const $ = this.$(response.data);
    const dateUpload = parseXiutakuDate($('.article-info > small').first().text());
    const maxPage = Number($('.pagination-list > span:last-child > a').first().text().trim()) || 1;
    const base = this.absUrl(mangaUrl).split('?')[0];
    const chapters: Chapter[] = [];
    for (let p = maxPage; p >= 1; p--) {
      const full = `${base}?page=${p}`;
      chapters.push({
        url: full.startsWith(this.baseUrl) ? full.slice(this.baseUrl.length) : full,
        name: `Page ${p}`,
        dateUpload,
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl, { headers: MOBILE_HEADERS });
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('.article-fulltext img').each((i, el) => {
      const imageUrl = this.absUrl($(el).attr('src') || '');
      if (!imageUrl) return;
      pages.push({ index: i, imageUrl });
    });
    return pages;
  }
}
