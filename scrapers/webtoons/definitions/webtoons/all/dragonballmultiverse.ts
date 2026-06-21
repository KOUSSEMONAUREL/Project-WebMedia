import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface PageLayout {
  scale: number;
  balloons: BalloonBox[];
}

interface BalloonBox {
  text: string;
  left: number;
  top: number;
  width: number;
}

export class DragonBallMultiverseScraper extends BaseScraper {
  readonly name = 'Dragon Ball Multiverse';
  readonly baseUrl = 'https://www.dragonball-multiverse.com';
  readonly lang = 'all';

  async getPopular(_page: number): Promise<SearchResult> {
    const response = await this.get('/en/read.html');
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('#dbm-reads .dbm-read').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h3').text();
      const url = $el.find('a').first().attr('abs:href') || '';
      const thumbnailUrl = $el.find('img').first().attr('abs:src') || '';
      const description = $el.find('> div').text() || undefined;
      mangas.push({ url: url.replace(this.baseUrl, ''), title, thumbnailUrl, description, lang: this.lang });
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(_query: string, _page?: number): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return { url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const chapters: Chapter[] = [];
    $('.cadrelect.chapter').each((_, el) => {
      const $el = $(el);
      const url = $el.find('a[href]').first().attr('abs:href') || '';
      const name = $el.find('h4').text();
      chapters.push({ url: url.replace(this.baseUrl, ''), name });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('.pageslist a[href]').each((i, el) => {
      pages.push({ index: i, imageUrl: $(el).attr('abs:href') || '' });
    });
    return pages;
  }
}
