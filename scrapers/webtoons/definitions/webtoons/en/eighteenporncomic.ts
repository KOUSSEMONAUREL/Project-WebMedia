import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

export class EighteenporncomicScraper extends BaseScraper {
  override readonly name = '18 Porn Comic';
  override readonly baseUrl = 'https://18porncomic.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/list-manga/${page}`, { params: { order_by: 'views' } });
    return this._parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/list-manga/${page}`);
    return this._parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`/list-manga/${page}`, { params: { search: query } });
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string) {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('div.detail_name > h1').first().text().trim();
    const img = $('div.detail_avatar > img').first();
    const thumbnailUrl = this.absUrl(img.attr('src') || img.attr('data-src') || '');
    const description = $('div.detail_reviewContent').first().text().trim();
    const info = $('div.detail_listInfo').first();
      const statusText = info.find('div.item:contains(Status) div.info_value').text().trim();
      const author = info.find('div.info_label:contains(author) + div.info_value').text().trim();
      const authorAlt = info.find('div.info_label:contains(autor) + div.info_value').text().trim();
      const genre = info.find('div.info_value > a[href*=/manga-list/]').map((_i: any, el: any) => $(el).text()).get().join(', ');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: thumbnailUrl,
      lang: this.lang,
      description: description || undefined,
      author: author || authorAlt || undefined,
      genre: genre || undefined,
      status: (statusText === 'Completed' ? 2 : statusText === 'On Going' ? 1 : 0) as MangaStatus,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('div.chapter_box .item').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim();
      if (name && href) chapters.push({ name, url: this.absUrl(href) });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const html = res.data;
    const scriptMatch = html.match(/slides_p_path\s*=\s*\[([^\]]*)\]/);
    if (!scriptMatch) throw new Error('Unable to find image data in page');
    const encodedImages = scriptMatch[1]
      .replace(/"/g, '')
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    return encodedImages.map((encoded: string, index: number) => {
      const url = Buffer.from(encoded, 'base64').toString('utf-8');
      return { index, imageUrl: url.startsWith('/') ? this.absUrl(url) : url };
    });
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.story_item').each((_i: number, el: any) => {
      const $el = $(el);
      const a = $el.find('div.mg_info > div.mg_name a').first();
      const href = a.attr('href') ?? '';
      const title = a.text().trim();
      const img = $el.find('img').first();
      const thumb = img.attr('src') || img.attr('data-src') || '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('.pagination > li:last-child:not(.active)').length > 0;
    return { mangas, hasNextPage };
  }
}
