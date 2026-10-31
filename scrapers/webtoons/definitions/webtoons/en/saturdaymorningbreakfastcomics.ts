import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const ARCHIVE_PATH = '/comic/archive';
const TITLE = 'Saturday Morning Breakfast Comics';

export class SaturdayMorningBreakfastComicsScraper extends BaseScraper {
  readonly name = 'Saturday Morning Breakfast Comics';
  readonly baseUrl = 'https://smbc-comics.com';
  readonly lang = 'en';

  async getPopular(): Promise<SearchResult> {
    return { mangas: [this.manga()], hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const matches = query.trim().length > 0 && TITLE.toLowerCase().includes(query.trim().toLowerCase());
    return { mangas: matches ? [this.manga()] : [], hasNextPage: false };
  }

  private manga(): Manga {
    return {
      title: TITLE,
      url: `${this.baseUrl}${ARCHIVE_PATH}`,
      thumbnailUrl: 'https://smbc-comics.com/favicon.ico',
      author: 'Zach Weinersmith',
      artist: 'Zach Weinersmith',
      description: 'SMBC is a daily comic strip about life, philosophy, science, mathematics, and dirty jokes.',
      status: 1,
      lang: this.lang,
    };
  }

  async getMangaDetails(): Promise<Partial<Manga>> {
    return {
      title: TITLE,
      author: 'Zach Weinersmith',
      artist: 'Zach Weinersmith',
      status: 1,
      description: 'SMBC is a daily comic strip about life, philosophy, science, mathematics, and dirty jokes.',
      lang: this.lang,
    };
  }

  async getChapterList(): Promise<Chapter[]> {
    const res = await this.get(`${this.baseUrl}${ARCHIVE_PATH}`, { validateStatus: () => true });
    const $ = this.$(String(res.data));
    return $('option[value*="comic/"]')
      .map((index, el) => {
        const $el = $(el);
        const value = $el.attr('value') ?? '';
        const text = $el.text();
        const parts = text.split(' - ');
        return {
          name: parts[1] ?? text,
          url: `${this.baseUrl}/${value}`,
          chapterNumber: index + 1,
          dateUpload: parts[0] ? Date.parse(parts[0]) : undefined,
        };
      })
      .get()
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl), { validateStatus: () => true });
    const $ = this.$(String(res.data));
    const images: string[] = [];
    const comic = $('img#cc-comic').first().attr('src');
    if (comic) images.push(this.absUrl(comic));
    const after = $('#aftercomic > img').first().attr('src');
    if (after) images.push(this.absUrl(after));
    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
