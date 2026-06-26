import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class CutieComicsScraper extends BaseScraper {
  readonly name = 'Cutie Comics';
  readonly baseUrl = 'https://cutiecomics.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/page/${page}`);
    return this._parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    throw new Error('Cutie Comics: getLatest() not supported');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.length < 4) return { mangas: [], hasNextPage: false };
    const body = new URLSearchParams({
      do: 'search',
      subaction: 'search',
      full_search: '0',
      search_start: String(page),
      result_from: String((page - 1) * 20 + 1),
      story: query,
    });
    const res = await this.client.post(this.absUrl('/index.php?do=search'), body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('h1#page-title').text().trim(),
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('div.galery > img').first().attr('src') || ''),
      description: $("meta[name=description]").attr("content") || undefined,
      genre: $('h3.field-label ~ span').map((_: any, el: any) => $(el).text()).get().join(', '),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: mangaUrl, chapterNumber: 1 }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('div.galery > img').each((i, el) => {
      const src = $(el).attr('src');
      if (src) pages.push({ index: i, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('#dle-content > div.w25').each((_, el) => {
      const $el = $(el);
      const titleLink = $el.find('strong.field-content > a').first();
      const href = titleLink.attr('href') ?? '';
      const title = titleLink.text().trim();
      const img = $el.find('a > img').first();
      const thumb = img.attr('src') ?? '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('.navigation > a > i.fa-angle-right').length > 0;
    return { mangas, hasNextPage };
  }
}
