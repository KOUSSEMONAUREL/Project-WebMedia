import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class XkcdScraper extends BaseScraper {
  readonly name = 'xkcd';
  readonly baseUrl = 'https://xkcd.com';
  readonly lang = 'en';

  private readonly creator = 'Randall Munroe';
  private readonly synopsis = 'A webcomic of romance, sarcasm, math and language.';

  private comicDateMapping: Map<number, string> | null = null;
  private comicDateMappingTime = 0;
  private allChaptersCache: Chapter[] | null = null;
  private allChaptersCacheTime = 0;

  async getPopular(_page = 1): Promise<SearchResult> {
    const chapters = await this.getAllComicsAsChapters();
    const allKeys = ['SINGLE'];
    const mangas = allKeys.map(key => {
      const firstChapter = chapters[0];
      const thumbnailUrl = firstChapter ? this.fetchThumbnailUrlForChapter(firstChapter) : 'https://thumbnail/xkcd.png';
      return {
        url: key,
        title: 'xkcd',
        thumbnailUrl,
        lang: this.lang,
        author: this.creator,
        artist: this.creator,
        description: this.synopsis,
      };
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(_query: string, _page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  private async getComicDateMappingFromEnglishArchive(): Promise<Map<number, string>> {
    const now = Date.now();
    if (this.comicDateMapping && now - this.comicDateMappingTime < 3600000) {
      return this.comicDateMapping;
    }
    try {
      const res = await this.get('https://xkcd.com/archive/');
      const $ = this.$(res.data);
      const map = new Map<number, string>();
      $('#middleContainer > a').each((_: any, el: any) => {
        const href = $(el).attr('href') || '';
        const num = parseInt(href.replace(/\//g, ''), 10);
        const date = $(el).attr('title') || '';
        if (num) map.set(num, date);
      });
      this.comicDateMapping = map;
      this.comicDateMappingTime = now;
    } catch (err) {
      console.error(`Failed to fetch xkcd archive: ${err instanceof Error ? err.message : err}`);
      this.comicDateMapping = new Map();
    }
    return this.comicDateMapping || new Map();
  }

  private async getAllComicsAsChapters(): Promise<Chapter[]> {
    const now = Date.now();
    if (this.allChaptersCache && now - this.allChaptersCacheTime < 3600000) {
      return this.allChaptersCache;
    }
    const res = await this.get('/archive');
    this.allChaptersCache = this.parseChapterList(res);
    this.allChaptersCacheTime = now;
    return this.allChaptersCache;
  }

  private parseChapterList(res: any): Chapter[] {
    const $ = this.$(res.data);
    return $('#middleContainer > a').map((_: any, el: any) => {
      const href = $(el).attr('href') || '';
      const num = parseInt(href.replace(/\//g, ''), 10);
      const title = $(el).text().trim();
      const dateStr = $(el).attr('title') || '';
      const dateUpload = this.parseDate(dateStr);
      return {
        url: `/num=${num}`,
        name: `${num}: ${title}`,
        chapterNumber: num,
        dateUpload,
      } as Chapter;
    }).get();
  }

  private parseDate(str: string): number | undefined {
    const parts = str.split('-');
    if (parts.length !== 3) return undefined;
    const normalized = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    const d = new Date(normalized + 'T00:00:00Z');
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return this.getAllComicsAsChapters();
  }

  private fetchThumbnailUrlForChapter(chapter: Chapter): string {
    return 'https://thumbnail/xkcd.png';
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const num = chapterUrl.replace('/num=', '');
    const res = await this.get(`/${num}/`);
    const $ = this.$(res.data);
    const img = $('#comic > img').first();
    if (!img) throw new Error('To experience the interactive version of this comic, open it in WebView/browser.');

    let imageUrl = img.attr('src') || '';
    if (img.attr('srcset')) {
      imageUrl = (img.attr('srcset') || '').split(' ')[0];
    }
    if (!imageUrl.startsWith('http')) {
      imageUrl = `https:${imageUrl}`;
    }

    return [
      { index: 0, imageUrl },
      { index: 1, imageUrl: '' },
    ];
  }
}
