import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class LikeMangaScraper extends BaseScraper {
  readonly name = 'LikeManga';
  readonly baseUrl = 'https://likemanga.ink';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this._search({ page, sort: 'top-manga' });
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this._search({ page, sort: 'lastest-chap' });
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this._search({ page, keyword: query });
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('#title-detail-manga').text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.detail-info img').attr('data-src') ?? $('.detail-info img').attr('src') ?? ''),
      description: $('#summary_shortened').text().trim() || undefined,
      author: $('.list-info .author p:nth-child(2)').text().trim() || undefined,
      genre: $('.list-info a[href*=/genres/]').map((_: any, el: any) => $(el).text()).get().join(', '),
      status: (() => { const s = $('.list-info .status p:nth-child(2)').text().toLowerCase(); return s.includes('complete') ? 2 : s.includes('in process') ? 1 : s.includes('pause') ? 3 : 0; })(),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.wp-manga-chapter').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim();
      const dateText = $(el).find('.chapter-release-date').text().trim();
      let dateUpload: number | undefined;
      if (dateText) { const ts = Date.parse(dateText); if (!isNaN(ts)) dateUpload = ts; }
      if (name && href) chapters.push({ name, url: href, dateUpload });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('div.reading-detail.box_doc img:not(noscript img)').each((i, el) => {
      const url = $(el).attr('data-cfsrc') ?? $(el).attr('data-src') ?? $(el).attr('data-lazy-src') ?? $(el).attr('src') ?? '';
      if (url) pages.push({ index: i, imageUrl: this.absUrl(url) });
    });
    return pages;
  }

  private async _search(opts: { page?: number; sort?: string; keyword?: string }): Promise<SearchResult> {
    const params: Record<string, string> = { act: 'searchadvance' };
    if (opts.sort) params['f[sortby]'] = opts.sort;
    if (opts.keyword) params['f[keyword]'] = opts.keyword;
    if (opts.page && opts.page > 1) params.pageNum = String(opts.page);
    const res = await this.get('/', { params });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('div.card-body div.card').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') ?? '';
      const title = $el.find('.title-manga').text().trim();
      const thumb = $el.find('img').attr('data-src') ?? $el.find('img').attr('src') ?? '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('ul.pagination a:contains(»)').length > 0;
    return { mangas, hasNextPage };
  }
}
