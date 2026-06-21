import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class FoamGirlScraper extends BaseScraper {
  override readonly name = 'FoamGirl';
  override readonly baseUrl = 'https://foamgirl.net';
  override readonly lang = 'all';

  private HAS_NEXT_PAGE_REGEX = /(\d+_\d+)/;

  private getDate(str: string): number | undefined {
    const match = str.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    if (!match) return undefined;
    const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.update_area .i_list').toArray().map(el => {
      const $el = $(el);
      const thumbnailUrl = this.absUrl($el.find('img').attr('data-original') || '');
      const title = $el.find('a.meta-title').text().trim();
      const url = this.absUrl($el.find('a').first().attr('href') || '');
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('a.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/page/${page}/?post_type=post&s=${encodeURIComponent(query)}`;
    const res = await this.get(url);
    return this.parseMangaList(res.data);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/page/${page}`;
    const res = await this.get(url);
    return this.parseMangaList(res.data);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(_mangaUrl: string): Promise<Partial<Manga>> {
    return {};
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapterUrl = this.absUrl($('link[rel=canonical]').attr('href') || '');
    const dateText = $('span.image-info-time').text().substring(1);
    const dateUpload = dateText ? this.getDate(dateText) : undefined;
    return [{ name: 'GALLERY', url: chapterUrl, dateUpload }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const allPages: Page[] = [];
    let currentUrl: string | null = chapterUrl;

    while (currentUrl) {
      const res = await this.get(currentUrl);
      const $ = this.$(res.data);
      $('.imageclick-imgbox').each((_i, el) => {
        allPages.push({
          index: allPages.length,
          imageUrl: this.absUrl($(el).attr('href') || ''),
        });
      });
      const nextEl = $('.page-numbers[title=Next page]').first();
      const nextUrl = nextEl.length > 0 ? this.absUrl(nextEl.attr('href') || '') : null;
      currentUrl = nextUrl && this.HAS_NEXT_PAGE_REGEX.test(nextUrl) ? nextUrl : null;
    }
    return allPages;
  }
}
