import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class OnepunchmanonlineScraper extends BaseScraper {
  readonly name = 'One Punch Man Online';
  readonly baseUrl = 'https://w20.1punchman.com';
  readonly lang = 'en';

  private singleManga(): Manga {
    return {
      title: 'One Punch Man',
      url: '/',
      thumbnailUrl: 'https://1punchman.com/wp-content/uploads/2024/02/9782380712018_1_75.jpg',
      author: 'ONE',
      artist: 'Murata Yusuke',
      description: 'One-Punch Man is a superhero who has trained so hard that his hair has fallen out, and who can overcome any enemy with one punch.',
      genre: 'Action, Comedy, Superhero, Seinen',
      lang: this.lang,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    return { mangas: [this.singleManga()], hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    throw new Error('getLatest is not supported');
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const manga = this.singleManga();
    return manga.title.toLowerCase().includes(query.trim().toLowerCase())
      ? { mangas: [manga], hasNextPage: false }
      : { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return { url: mangaUrl, title: 'One Punch Man', lang: this.lang };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul li a[href*="/manga/"]').each((_, el) => {
      const $el = $(el);
      chapters.push({ name: $el.text().trim(), url: this.absUrl($el.attr('href') || '') });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    const urls: string[] = [];
    $('div.entry-content img, .separator img, p img').each((_, el) => {
      const $el = $(el);
      const u = $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('src') || '';
      if (u.startsWith('http')) urls.push(u);
    });
    return urls.map((u, i) => ({ index: i, imageUrl: u }));
  }
}
