import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class WeebCentralScraper extends BaseScraper {
  readonly name = 'Weeb Central';
  readonly baseUrl = 'https://weebcentral.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this._search(page, '');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this._search(page, query);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const sections = $('section[x-data] > section');
    const info = $(sections[0]);
    const content = $(sections[1]);
    return {
      title: content.find('h1').first().text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl(info.find('source').first().attr('srcset')?.replace('small', 'normal') || info.find('img').first().attr('src') || ''),
      description: content.find('li:has(strong:contains(Description)) > p').text().trim() || undefined,
      author: info.find('ul > li:has(strong:contains(Author)) > span > a').map((_: any, el: any) => $(el).text()).get().join(', ') || undefined,
      genre: info.find('ul > li:has(strong:contains(Tag),strong:contains(Type)) a').map((_: any, el: any) => $(el).text()).get().join(', '),
      status: (() => { const s = info.find('ul > li:has(strong:contains(Status)) > a').text().toLowerCase(); return s === 'ongoing' ? 1 : s === 'complete' ? 2 : s === 'hiatus' ? 3 : s === 'canceled' ? 3 : 0; })(),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const chapterUrl = mangaUrl.replace(/\/$/, '').replace(/\/[^/]+$/, '/full-chapter-list');
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('div[x-data] > a').each((_, el) => {
      const name = $(el).find('span.flex > span').first().text().trim();
      const url = $(el).attr('href') ?? '';
      const dateStr = $(el).find('time[datetime]').attr('datetime');
      let dateUpload: number | undefined;
      if (dateStr) { const ts = Date.parse(dateStr); if (!isNaN(ts)) dateUpload = ts; }
      if (name && url) chapters.push({ name, url: this.absUrl(url), dateUpload });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const pagesUrl = `${chapterUrl.replace(/\/$/, '')}/images?is_prev=False&reading_style=long_strip`;
    const res = await this.get(pagesUrl);
    const $ = this.$(res.data);
    return $('section[x-data~=scroll] > img').map((i: number, el: any) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    })).get();
  }

  private async _search(page: number, query: string): Promise<SearchResult> {
    const res = await this.get('/search/data', {
      params: {
        text: query.replace(/[!#:(),-]/g, ' ').trim(),
        limit: '32',
        offset: String((page - 1) * 32),
        display_mode: 'Full Display',
      },
    });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('article > section > a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const title = $(el).find('div:not([class]):last-child').text().trim();
      const thumb = $(el).find('source').first().attr('srcset')?.replace('small', 'normal') || $(el).find('img').first().attr('src') || '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('button').length > 0;
    return { mangas, hasNextPage };
  }
}
