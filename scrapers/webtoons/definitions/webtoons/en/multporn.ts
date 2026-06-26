import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MultpornScraper extends BaseScraper {
  readonly name = 'Multporn';
  readonly baseUrl = 'https://multporn.net';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get('/best', { params: { page: String(page - 1) } });
    return this._parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get('/new', { params: { page: String(page - 1) } });
    return this._parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get('/search', {
      params: { page: String(page - 1), search_api_views_fulltext: query },
    });
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const getField = (label: string) => $(`.field:has(.field-label:contains(${label}:)) .links a`).map((_: any, el: any) => $(el).text()).get();
    const sections = getField('Section');
    const characters = getField('Characters');
    const tags = getField('Tags');
    const authors = getField('Author');
    const pageCount = $('.jb-image img').length;
    return {
      title: $('h1#page-title').text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: '',
      description: `Section:\n${sections.join(', ')}\n\nCharacters:\n${characters.join(', ')}\n\nPages:\n${pageCount}` || undefined,
      author: authors.join(', ') || undefined,
      artist: authors.join(', ') || undefined,
      genre: [...tags, ...sections, ...characters].join(', '),
      status: sections.some((s: string) => s === 'Ongoings') ? 1 : 2,
      lang: this.lang,
    };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Chapter', url: _mangaUrl, chapterNumber: 1 }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('.jb-image img').map((i: number, el: any) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('src') || '').replace('/styles/juicebox_2k/public', '').split('?')[0],
    })).get();
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.masonry-item').each((_, el) => {
      const title = $(el).find('.views-field-title').text().trim();
      const url = $(el).find('.views-field-title a').first().attr('href') ?? '';
      const thumb = $(el).find('img').first().attr('src') ?? '';
      if (title && url) mangas.push({ title, url: this.absUrl(url), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('.pager-next a').length > 0;
    return { mangas, hasNextPage };
  }
}
