import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const IMG_SERVER = 'https://hentaicdn.com';

export class HentaiHereScraper extends BaseScraper {
  readonly name = 'HentaiHere';
  readonly baseUrl = 'https://hentaihere.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get('/');
    return this._parseList(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get('/directory/newest', { params: { page: String(page) } });
    return this._parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get('/search', { params: { s: query, sort: 'newest', page: String(page) } });
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const categories = $('#info .text-info:contains(Cat) ~ a').map((_: any, el: any) => $(el).text()).get();
    const contents = $('#info .text-info:contains(Content:) ~ a').map((_: any, el: any) => $(el).text()).get();
    const licensed = categories.find((c: string) => c === 'Licensed');
    return {
      title: $('h4 > a').first().text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('#cover img').first().attr('src') || ''),
      description: $('#info > div:has(> .text-info:contains(Brief Summary:))').first().text().replace('Brief Summary:', '').trim() || undefined,
      author: $('#info .text-info:contains(Artist:) ~ a').map((_: any, el: any) => $(el).text()).get().join(', ') || undefined,
      status: (licensed ? 6 : (() => { const s = $('#info .text-info:contains(Status:) ~ a').first().text(); return s === 'Completed' ? 2 : s === 'Ongoing' ? 1 : 0; })()) as MangaStatus,
      genre: [...categories, ...contents].join(', '),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('li.sub-chp > a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const name = $(el).text().trim();
      if (name && href) chapters.push({ name, url: href });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const match = res.data.match(/var rff_imageList = \[([^\]]*)\]/);
    if (!match) return [];
    const paths: string[] = JSON.parse(`[${match[1]}]`);
    return paths.map((path, i) => ({ index: i, imageUrl: `${IMG_SERVER}/hentai${path}` }));
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.item').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const href = a.attr('href') ?? '';
      const img = $el.find('.pos-rlt img');
      const title = img.attr('alt') || a.text().trim();
      const thumb = img.attr('src') ?? '';
      let author: string | undefined;
      const mutedText = $el.find('div:not(.pos-rtl) > .text-muted').text().trim();
      const artistMatch = mutedText.match(/by\s+(.+?)\./);
      if (artistMatch && artistMatch[1] !== '-' && artistMatch[1] !== 'Unknown') author = artistMatch[1];
      if (title && href) mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), author, lang: this.lang });
    });
    const hasNextPage = $('.pagination > li:last-child:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }
}
