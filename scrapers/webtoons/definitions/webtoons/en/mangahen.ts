import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class MangahenScraper extends BaseScraper {
  readonly name = 'Gensura';
  readonly baseUrl = 'https://gensura.net';
  readonly lang = 'en';
  private readonly advSearchURL = 'https://gensura.net/advanced-search';
  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/advanced-search/?search=1&type=0&sort=1&page=${page}`);
    return this.parsePopular(res.data);
  }
  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/advanced-search/?search=1&type=0&sort=2&page=${page}`);
    return this.parsePopular(res.data);
  }
  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`/advanced-search/?name=${encodeURIComponent(query)}&search=1&page=${page}`);
    return this.parsePopular(res.data);
  }
  private async parsePopular(html: string): Promise<SearchResult> {
    const $ = this.$(html);
    const mangas: Manga[] = $('a[href^=/manga/]').toArray().map(el => {
      const $el = $(el);
      const title = $el.find('h2').first().ownText();
      const url = this.absUrl($el.attr('href') || '');
      const thumbnailUrl = this.absUrl($el.find('img').attr('src') || '');
      return { title, url, thumbnailUrl, lang: 'en' };
    }).filter(m => m.title);
    const hasNextPage = $('a[href*=page]').toArray().some(el => $(el).text().trim() === '');
    return { mangas, hasNextPage };
  }
  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const authors = $('a[href*=/circles/]').toArray().map(el => $(el).text()).join(', ');
    const artists = $('a[href*=/authors/]').toArray().map(el => $(el).text()).join(', ');
    const titles = $('h1.font-semibold').text().split(' | ');
    const altit = $('h2.text-lg.font-medium').text();
    const genre = $('a[href*=/tags/]').toArray().map(el => $(el).text()).join(', ');
    const description = [
      titles[1] ? `Alternative Titles: \n- ${titles[1]}` : '',
      altit ? `- ${altit}` : '',
      `Categories: ${$('a[href*=/categories/]').text()}`,
      `Parodies: ${$('a[href*=/parodies/]').text()}`,
      `Circles: ${$('a[href*=/circles/]').text()}`,
      $('tr:contains(page)').text(),
      $('tr:contains(view)').text(),
    ].filter(Boolean).join('\n');
    const thumbnailUrl = this.absUrl($('img[src*=thumbnail].w-96').attr('src') || '');
    return {
      title: titles[0],
      url: mangaUrl,
      thumbnailUrl,
      lang: 'en',
      author: authors || artists || undefined,
      description: description || undefined,
    };
  }
  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: mangaUrl }];
  }
  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('img[src*=images]:not(img[src*=thumbnail]).w-full, img[data-src*=images]').toArray().map((el, i) => {
      const $el = $(el);
      const imageUrl = (this.absUrl($el.attr('src') || '') || this.absUrl($el.attr('data-src') || '')).replace(/-t(?=\.)/g, '');
      return { index: i, imageUrl };
    });
  }
}
