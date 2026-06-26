import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

export class HiveworksScraper extends BaseScraper {
  readonly name = 'Hiveworks Comics';
  readonly baseUrl = 'https://hiveworkscomics.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('div.comicblock').each((_i: number, el: any) => {
      const $el = $(el);
      const a = $el.find('a.comiclink').first();
      const href = a.attr('href') ?? '';
      const title = $el.find('h1').text().trim();
      const thumb = $el.find('img').first().attr('src') ?? '';
      const artist = $el.find('h2').text().replace(/^by\s*/i, '').trim();
      if (title && href) mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb),
        author: artist || undefined,
        description: $el.find('div.description').text().trim() || undefined,
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const q = query.toLowerCase();
    const mangas: Manga[] = [];
    $('div.comicblock').each((_i: number, el: any) => {
      const $el = $(el);
      const a = $el.find('a.comiclink').first();
      const href = a.attr('href') ?? '';
      const title = $el.find('h1').text().trim();
      if (!title.toLowerCase().includes(q)) return;
      const thumb = $el.find('img').first().attr('src') ?? '';
      const artist = $el.find('h2').text().replace(/^by\s*/i, '').trim();
      if (title && href) mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb),
        author: artist || undefined,
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const $block = $('div.comicblock').filter((_i: number, el: any) => {
      const href = $(el).find('a.comiclink').first().attr('href') ?? '';
      return href === mangaUrl || href.replace(/[?#].*$/, '') === mangaUrl.replace(/[?#].*$/, '');
    }).first();
    if ($block.length) {
      const a = $block.find('a.comiclink').first();
      return {
        title: $block.find('h1').text().trim(),
        url: a.attr('href') ?? mangaUrl,
        thumbnailUrl: this.absUrl($block.find('img').first().attr('src') ?? ''),
        description: $block.find('div.description').text().trim() || undefined,
        author: $block.find('h2').text().replace(/^by\s*/i, '').trim() || undefined,
        lang: this.lang,
      };
    }
    const res2 = await this.get(mangaUrl);
    const $2 = this.$(res2.data);
    return {
      title: $2('h1').first().text().trim() || $2('title').text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: $2('link[rel=icon]').attr('href') || $2('img').first()?.attr('src') || '',
      description: $2("meta[name=description]").attr("content") || undefined,
      author: $2("meta[name=author]").attr("content") || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('select[name=comic] option').each((_i: number, el: any) => {
      const href = $(el).attr('value') ?? '';
      const name = $(el).text().trim();
      if (name && href) chapters.push({ name, url: this.absUrl(href) });
    });
    if (chapters.length > 0) return chapters;
    $('a[href*="comic/archive"], a[href*="archive"]').each((_i: number, el: any) => {
      const href = $(el).attr('href') ?? '';
      const name = $(el).text().trim();
      if (name && href) chapters.push({ name, url: this.absUrl(href) });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('div#cc-comicbody img').each((i: number, el: any) => {
      const src = $(el).attr('src') ?? '';
      if (src) pages.push({ index: i, imageUrl: this.absUrl(src) });
    });
    return pages;
  }
}
