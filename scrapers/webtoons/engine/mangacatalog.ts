import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

export abstract class MangaCatalogScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected sourceList: Array<{ name: string; url: string }>;

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
    this.sourceList = [{ name, url: this.baseUrl }];
  }

  /** Sorted by name, deduplicated by url — mirrors the upstream MangaCatalog sourceList. */
  private buildSourceList(): Array<{ name: string; url: string }> {
    return [...this.sourceList]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((entry, index, list) => list.findIndex(e => e.url === entry.url) === index);
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const mangas: Manga[] = this.buildSourceList().map(({ name, url }) => ({
      title: name,
      url,
      thumbnailUrl: '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const lower = query.toLowerCase();
    const mangas: Manga[] = this.buildSourceList()
      .filter(({ name }) => name.toLowerCase().includes(lower))
      .map(({ name, url }) => ({
        title: name,
        url,
        thumbnailUrl: '',
        lang: this.lang,
      }));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('div.container > h1').text().trim();
    const info = $('div.bg-bg-secondary > div.px-6 > div.flex-col').text();
    const description = info.includes('Description')
      ? info.substring(info.indexOf('Description') + 'Description'.length).trim()
      : info;
    const thumbnailUrl = this.absUrl($('div.flex > img').attr('src') || '');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      lang: this.lang,
      description: description || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const selector = 'div.w-full > div.bg-bg-secondary > div.grid';
    return $(selector).toArray().map(el => {
      const $el = $(el);
      const name1 = $el.find('.col-span-4 > a').text().trim();
      const name2 = $el.find('.text-xs:not(a)').text().trim();
      const name = name2 ? `${name1} - ${name2}` : name1;
      const url = this.absUrl($el.find('.col-span-4 > a').attr('href') || '');
      return { name, url };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('img[data-src]').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('data-src') || ''),
    }));
  }
}
