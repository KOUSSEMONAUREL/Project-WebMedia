import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HentaiNexusScraper extends BaseScraper {
  readonly name = 'HentaiNexus';
  readonly baseUrl = 'https://hentainexus.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    if (page === 1) {
      const res = await this.get('/explore/hot');
      return this._parseList(res.data, true);
    }
    return this.getSearch('', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(page > 1 ? `/page/${page}` : '/');
    return this._parseList(res.data, false);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params: Record<string, string> = { q: query };
    const path = page > 1 ? `/page/${page}` : '/';
    const res = await this.get(path, { params });
    return this._parseList(res.data, false);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const table = $('.view-page-details').first();
    const artists = table.find('td.viewcolumn:contains(Artist) + td a').map((_: any, el: any) => $(el).text()).get();
    const authors = table.find('td.viewcolumn:contains(Author) + td a').map((_: any, el: any) => $(el).text()).get();
    const author = [...new Set([...authors, ...artists])].join(', ');
    const tags = table.find('span.tag a').map((_: any, el: any) => $(el).text().replace(/\s*\([\d,]+\)$/, '')).get().join(', ');
    const desc = (() => { let d = ''; ['Circle', 'Event', 'Magazine', 'Parody', 'Publisher', 'Pages', 'Favorites'].forEach(k => { const cell = table.find(`td.viewcolumn:contains(${k}) + td`); const v = cell.first().text().trim() || cell.find('a').first().text().trim(); if (v) d += `${k}: ${v}\n`; }); const descCell = table.find('td.viewcolumn:contains(Description) + td').text().trim(); if (descCell) d += `\n${descCell}`; return d.trim(); })();
    return {
      title: $('h1.title').text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('figure.image img').first().attr('src') || ''),
      description: desc || undefined,
      author: author || undefined,
      genre: tags || undefined,
      status: 2,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('/').pop() || '';
    const dateStr = this.$(await (await this.get(mangaUrl)).data).find('.view-page-details td.viewcolumn:contains(Published) + td').text().trim();
    let dateUpload: number | undefined;
    if (dateStr) { const ts = Date.parse(dateStr); if (!isNaN(ts)) dateUpload = ts; }
    return [{ name: 'Chapter', url: `/read/${id}`, dateUpload }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const match = res.data.match(/initReader\("([^"]+)"/);
    if (!match) return [];
    const decrypted = this._decryptData(match[1]);
    const data = JSON.parse(decrypted);
    return data.filter((d: any) => d.type === 'image').map((d: any, i: number) => ({ index: i, imageUrl: d.image || d.image_fallback }));
  }

  private _decryptData(encoded: string): string {
    let result = '';
    for (let i = 0; i < encoded.length; i += 2) {
      const hex = encoded.substr(i, 2);
      result += String.fromCharCode(parseInt(hex, 16) ^ 0x5A);
    }
    return result;
  }

  private _parseList(html: string, isPopularNow: boolean): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.container .column').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') ?? '';
      const title = $el.find('.card-header-title').text().trim();
      const thumb = $el.find('.card-image img').attr('src') ?? '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = isPopularNow || $('a.pagination-next[href]').length > 0;
    return { mangas, hasNextPage };
  }
}
