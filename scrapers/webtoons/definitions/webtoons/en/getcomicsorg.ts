import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

export class GetComicsOrgScraper extends BaseScraper {
  readonly name = 'GetComics';
  readonly baseUrl = 'https://getcomics.org';
  readonly lang = 'en';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`/?s=${encodeURIComponent(query)}&page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];

    for (const el of $('article').toArray()) {
      const $el = $(el);
      const link = $el.find('.post-title a').first();
      const img = $el.find('.post-header-image img').first();
      const url = link.attr('href');
      const title = link.text().trim() || img.attr('alt');
      const thumbnail = img.attr('src');
      if (url && title) {
        mangas.push({
          title: title.trim(),
          url,
          thumbnailUrl: thumbnail || '',
          lang: 'en',
        });
      }
    }

    const hasNextPage = $('.next.page-numbers, a.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/page/${page}/`);
    const $ = this.$(res.data);
    return this.parseArticles($);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.post-title h1').first().text().trim() || $('h1').first().text().trim();
    const description = $('meta[name="description"]').attr('content') || '';
    const thumbnail = $('.post-header-image img').first().attr('src') || $('article img').first().attr('src') || '';
    return { title, description, thumbnailUrl: thumbnail };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];

    for (const el of $('.aio-button-center .aio-pulse a[rel="nofollow"]').toArray()) {
      const $a = $(el);
      const host = $a.attr('title') || $a.text().trim();
      const url = $a.attr('href');
      if (url && host && host.toUpperCase() !== 'DOWNLOAD NOW') {
        chapters.push({
          name: host.toUpperCase().replace(/^DOWNLOAD\s+/i, ''),
          url,
          chapterNumber: chapters.length + 1,
        });
      }
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    return [{ imageUrl: chapterUrl, index: 0 }];
  }

  private parseArticles($: CheerioAPI): SearchResult {
    const mangas: Manga[] = [];
    for (const el of $('article').toArray()) {
      const $el = $(el);
      const link = $el.find('.post-title a').first();
      const img = $el.find('.post-header-image img').first();
      const url = link.attr('href');
      const title = link.text().trim() || img.attr('alt');
      const thumbnail = img.attr('src');
      if (url && title) {
        mangas.push({
          title: title.trim(),
          url,
          thumbnailUrl: thumbnail || '',
          lang: 'en',
        });
      }
    }
    return { mangas, hasNextPage: $('.next.page-numbers, a.next').length > 0 };
  }
}
