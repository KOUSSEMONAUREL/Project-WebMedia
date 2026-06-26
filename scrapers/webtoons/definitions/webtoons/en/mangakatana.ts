import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MangaKatanaScraper extends BaseScraper {
  readonly name = 'MangaKatana';
  readonly baseUrl = 'https://mangakatana.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/manga/page/${page}`);
    return this._parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/page/${page}`);
    return this._parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`/page/${page}`, { params: { search: query, search_by: 'book_name' } });
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('h1.heading').text().trim() || $('h1').text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('div.media div.cover img').attr('src') || $('img').first()?.attr('src') || ''),
      description: $('.summary p').text().trim() || undefined,
      author: $('.author').text().replace(/^Author:\s*/i, '').trim() || undefined,
      status: $('.value.status').text().includes('Ongoing') ? 1 : $('.value.status').text().includes('Completed') ? 2 : 0,
      genre: $('.genres a').map((_: any, el: any) => $(el).text()).get().join(', '),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('tr:has(.chapter)').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim();
      const dateText = $(el).find('.update_time').text().trim();
      let dateUpload: number | undefined;
      if (dateText) {
        const ts = Date.parse(dateText);
        if (!isNaN(ts)) dateUpload = ts;
      }
      if (name && href) chapters.push({ name, url: href, dateUpload });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('script:contains(data-src)').each((_, s) => {
      const text = $(s).html() ?? '';
      const match = text.match(/data-src['"],\s*(\w+)/);
      if (match) {
        const varName = match[1];
        const arrMatch = text.match(new RegExp(`var ${varName}=\\[([^\\]]*)]`));
        if (arrMatch) {
          const urls = arrMatch[1].match(/'([^']*)'/g);
          if (urls) {
            urls.forEach((url, i) => {
              const clean = url.replace(/'/g, '');
              if (clean) pages.push({ index: i, imageUrl: this.absUrl(clean) });
            });
          }
        }
      }
    });
    return pages;
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div#book_list > div.item').each((_, el) => {
      const $el = $(el);
      const a = $el.find('div.text > h3 > a').first();
      const href = a.attr('href') ?? '';
      const title = a.text().trim();
      const thumb = $el.find('img').first().attr('src') ?? '';
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('a.next.page-numbers').length > 0;
    return { mangas, hasNextPage };
  }
}
