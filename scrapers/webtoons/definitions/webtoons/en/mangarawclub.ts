import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class MangarawclubScraper extends BaseScraper {
  readonly name = 'MangaGeko';
  readonly baseUrl = 'https://www.mgeko.cc';
  readonly lang = 'en';
  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/browse-comics/data/?page=${page}&sort=popular_all_time&safe_mode=0`);
    return this.parseSearch(res.data);
  }
  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/browse-comics/data/?page=${page}&sort=latest&safe_mode=0`);
    return this.parseSearch(res.data);
  }
  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`/search/?search=${encodeURIComponent(query)}&results=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('.novel-item').toArray().map(el => {
      const $el = $(el);
      const title = $el.find('.novel-title').text();
      const img = $el.find('.novel-cover img');
      const thumbnailUrl = this.absUrl(img.attr('data-src') || img.attr('src') || '');
      const url = this.absUrl($el.find('a').attr('href') || '');
      return { title, url, thumbnailUrl, lang: 'en' };
    });
    const hasNextPage = $('nav.paging a:contains(Next)').length > 0;
    return { mangas, hasNextPage };
  }
  private async parseSearch(html: string): Promise<SearchResult> {
    const data = typeof html === 'string' ? JSON.parse(html) : html;
    const $ = this.$(data.html || data.results_html);
    const mangas: Manga[] = $('.comic-card').toArray().map(el => {
      const $el = $(el);
      const title = $el.find('.comic-card__title a').text();
      const img = $el.find('.comic-card__cover img');
      const thumbnailUrl = this.absUrl(img.attr('data-src') || img.attr('src') || '');
      const url = this.absUrl($el.find('a').attr('href') || '');
      return { title, url, thumbnailUrl, lang: 'en' };
    });
    const hasNextPage = data.hasNextPage || false;
    return { mangas, hasNextPage };
  }
  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    if (!$('.novel-header').length) throw new Error('Page not found');
    const author = $('.author a').attr('title')?.trim();
    const description = $('.description').text();
    const genre = $('.categories a[href*=genre]').toArray().map(el => $(el).text().trim()).join(', ');
    const thumbnailUrl = this.absUrl($('.cover img').attr('data-src') || $('.cover img').attr('src') || '');
    return { url: mangaUrl, lang: 'en', author: author?.toLowerCase() !== 'updating' ? author : undefined, description: description || undefined, thumbnailUrl };
  }
  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = mangaUrl.endsWith('/') ? mangaUrl : mangaUrl + '/';
    const res = await this.get(url + 'all-chapters/');
    const $ = this.$(res.data);
    return $('ul.chapter-list > li').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('a');
      const chapterUrl = this.absUrl(link.attr('href') || '');
      const chapterName = $el.find('.chapter-title, .chapter-number').first().text().replace('-eng-li', '');
      const name = `Chapter ${chapterName}`;
      const dateStr = $el.find('.chapter-update').attr('datetime');
      const dateUpload = dateStr ? new Date(dateStr).getTime() || undefined : undefined;
      return { name, url: chapterUrl, dateUpload };
    });
  }
  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('#chapter-reader img').toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}
