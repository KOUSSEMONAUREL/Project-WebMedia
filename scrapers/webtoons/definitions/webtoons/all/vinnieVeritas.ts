import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const ONCLICK_REGEX = /changeToComic\("(.+?)"\)/;

export class VinnieVeritasScraper extends BaseScraper {
  readonly name = 'Vinnie Veritas - CCC';
  readonly baseUrl = 'https://ccc.vinnieveritas.com';
  readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    const isEn = this.lang === 'en';
    return {
      mangas: [{
        url: '/archiveIndex.php',
        title: isEn ? 'CCC: The city of opportunities' : 'CCC: La ciudad de las oportunidades',
        thumbnailUrl: `${this.baseUrl}/comics/${isEn ? 'CCCr000E' : 'CCCr000'}.jpg`,
        lang: this.lang,
        author: 'Vinnie Veritas',
        artist: 'Vinnie Veritas',
        description: isEn
          ? 'Almost 7 years ago I started working on a project...'
          : 'Hace casi 7 años empecé un proyecto...',
      }],
      hasNextPage: false,
    };
  }

  async getSearch(_query: string, _page = 1): Promise<SearchResult> {
    throw new Error('Search not supported');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.cccLeftInd .cccArchiveEntry[onclick]').each((_: any, el: any) => {
      const onclick = $(el).attr('onclick') || '';
      const match = onclick.match(ONCLICK_REGEX);
      const comicName = match?.[1] || '';
      chapters.push({
        name: $(el).text().trim(),
        url: `/${comicName}.php`,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const selector = this.lang === 'en' ? 'img.cccComic.crazylan-en' : 'img.cccComic.crazylan-es';
    const pages: Page[] = [];
    $(selector).each((i: number, el: any) => {
      pages.push({ index: i, imageUrl: $(el).attr('src') || '' });
    });
    return pages;
  }
}
