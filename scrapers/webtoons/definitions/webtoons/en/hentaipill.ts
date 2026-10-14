import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/hentaipill` (HentaiPill.kt).
 * The extension was renamed upstream from `NhentaiClub` (vi, nhentaiclub.online)
 * to `HentaiPill` (en, hentaipill.com).
 *
 * - Popular: `/popular` (+ `/popular/N`)
 * - Latest:  `/language/english` (+ `/N`)
 * - Search:  `/search?q=<query>&page=N`
 * - List:    `div.galleries-list > div.gallery-item` — link `a[href*=/gallery/]`,
 *   url is the gallery id (`pathSegments[1]`), title `span`, cover `img.lazy` data-src
 * - Series:  `/gallery/<id>` — `div.reading-page-header h1`, cover on
 *   `button.js-button-favorite` data-cover, metadata rows `.table-row`
 * - Single chapter "Chapter" (gallery pages are the reader)
 */
export class HentaiPillScraper extends BaseScraper {
  readonly name = 'HentaiPill';
  readonly baseUrl = 'https://hentaipill.com';
  readonly lang = 'en';

  private parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.galleries-list > div.gallery-item').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('a[href*=/gallery/]').first();
      const href = $link.attr('href') || '';
      const segments = new URL(this.absUrl(href)).pathname.split('/').filter(Boolean);
      const id = segments[1];
      if (!id) return;
      mangas.push({
        url: id,
        title: $link.find('span').first().text().trim(),
        thumbnailUrl: this.absUrl($link.find('img.lazy').first().attr('data-src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('ul.pagination a[rel=next]').length > 0 };
  }

  private async listPage(path: string, page: number, query = false): Promise<SearchResult> {
    let url = path;
    if (query) url += `${path.includes('?') ? '&' : '?'}page=${page}`;
    else if (page > 1) url += `/${page}`;
    const res = await this.get(url);
    return this.parseList(res.data as string);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.listPage('/popular', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.listPage('/language/english', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) return this.getPopular(page);
    return this.listPage(`/search?q=${encodeURIComponent(query.trim())}`, page, true);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(`/gallery/${mangaUrl}`);
    const $ = this.$(res.data as string);

    const row = (label: string): string | undefined => {
      const values = $('.table-row')
        .filter((_i, tr) => $(tr).find('.table-label').text().includes(label))
        .first().find('.table-value a')
        .map((_i, a) => $(a).text().trim())
        .get();
      return values.length > 0 ? values.join(', ') : undefined;
    };

    const description = [
      ['Parodies', 'Parodies'],
      ['Characters', 'Characters'],
    ].flatMap(([label, prefix]) => {
      const value = row(label);
      return value ? [`${prefix}: ${value}`] : [];
    }).join('\n').trim();

    const dateText = $('div.reading-page-header-data span').first().text().trim();
    const dateUpload = Date.parse(`${dateText} UTC`);

    return {
      title: $('div.reading-page-header h1').first().text().trim(),
      url: `/gallery/${mangaUrl}`,
      thumbnailUrl: this.absUrl($('button.js-button-favorite').first().attr('data-cover') || ''),
      description: description || undefined,
      author: row('Artists'),
      artist: row('Artists'),
      genre: row('Tags'),
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(`/gallery/${mangaUrl}`);
    const dateText = this.$(res.data as string)('div.reading-page-header-data span').first().text().trim();
    const dateUpload = Date.parse(`${dateText} UTC`);
    return [{
      name: 'Chapter',
      url: mangaUrl,
      dateUpload: isNaN(dateUpload) ? undefined : dateUpload,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`/gallery/${chapterUrl}`);
    const $ = this.$(res.data as string);
    return $('div.reading-pages-content img.lazy')
      .map((_i, img) => ({
        index: _i,
        imageUrl: this.absUrl($(img).attr('data-src') || ''),
      }))
      .get()
      .filter((p) => p.imageUrl !== '');
  }
}

export default HentaiPillScraper;
