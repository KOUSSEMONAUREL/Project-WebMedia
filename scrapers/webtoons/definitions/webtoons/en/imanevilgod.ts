import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class IAmAnEvilGodScraper extends BaseScraper {
  readonly name = "I'm An Evil God";
  readonly baseUrl = 'https://imanevilgod.com';
  readonly lang = 'en';

  private singleManga(): Manga {
    return {
      title: "I'm An Evil God",
      url: '/',
      thumbnailUrl: '',
      lang: this.lang,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    return { mangas: [this.singleManga()], hasNextPage: false };
  }

  async getSearch(_query: string, _page = 1): Promise<SearchResult> {
    return { mangas: [this.singleManga()], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    return {
      title: "I'm An Evil God",
      url: mangaUrl,
      description:
        'Across the realms, the manliest and most handsome evil god in history! ' +
        "Xie Yan crosses over and falls into the vixen's lair...",
      thumbnailUrl: this.absUrl($('meta[property="og:image"]').first().attr('content') || ''),
      lang: this.lang,
    };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('p.has-medium-font-size a[href*=imanevilgod.com]').each((index: number, el: any) => {
      const $el = $(el);
      const name = $el.text().trim();
      const url = this.absUrl($el.attr('href') || '');
      if (!name || !url) return;
      chapters.push({ name, url, chapterNumber: index });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('div.entry-content img').each((index: number, el: any) => {
      const $el = $(el);
      const src = $el.attr('src') || $el.attr('data-src') || '';
      const imageUrl = this.absUrl(src);
      if (!imageUrl) return;
      pages.push({ index, imageUrl });
    });
    return pages;
  }
}
