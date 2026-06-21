import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const CHAPTER_DATE_REGEX = /\/(\d+)\/(\d+)\/(\d+)\/[^/]*\//;
const CHAPTER_TITLE_REGEX = /Permanent Link:\s*((?:\[(\d{4})])?\s*(?:\[[^\]]*(\d{4})])?.*)/;

export class SandraAndWooScraper extends BaseScraper {
  readonly name = 'Sandra and Woo';
  readonly baseUrl = 'https://www.sandraandwoo.com';
  readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    return {
      mangas: [{
        url: '/archive',
        title: this.name,
        thumbnailUrl: 'https://www.sandraandwoo.com/images/fanart/fanart-contest-2014/pictures/zheng-qu-01-color-corrected.jpg',
        lang: this.lang,
        author: 'Oliver Knörzer',
        artist: 'Powree',
        description: 'Sandra and Woo is a comedy comic strip featuring the 13-year-old girl Sandra North and her mischievous pet raccoon Woo.',
      }],
      hasNextPage: false,
    };
  }

  async getSearch(_query: string, _page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const elements = $('#column a').get().reverse();

    let lastChapterNumber = 0;
    const chapters: Chapter[] = [];

    for (const el of elements) {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const dateMatch = href.match(CHAPTER_DATE_REGEX);
      let dateUpload: number | undefined;
      if (dateMatch) {
        const [, y, m, d] = dateMatch;
        const dateStr = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        if (DATE_FORMAT.test(dateStr)) {
          dateUpload = new Date(dateStr + 'T00:00:00Z').getTime();
        }
      }

      const hover = $el.attr('title') || '';
      const titleMatch = hover.match(CHAPTER_TITLE_REGEX);
      const title = titleMatch?.[1] || hover;
      const numStr = titleMatch?.[2] || titleMatch?.[3] || '';
      const chapterNumber = numStr ? parseFloat(numStr) : Math.ceil((lastChapterNumber + 1) / 2) * 2;

      lastChapterNumber = chapterNumber;
      chapters.push({
        name: title,
        url: href,
        chapterNumber,
        dateUpload,
      });
    }

    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const imgUrl = $('#comic img').first().attr('src') || '';
    return [{ index: 0, imageUrl: imgUrl.startsWith('http') ? imgUrl : `${this.baseUrl}${imgUrl}` }];
  }
}
