import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const ARCHIVE_PATH = '/archive/';
const TITLE = 'The Draw Play';

export class TheDrawPlayScraper extends BaseScraper {
  readonly name = 'The Draw Play';
  readonly baseUrl = 'https://www.thedrawplay.com';
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
      thumbnailUrl: `${this.baseUrl}/wp-content/uploads/2025/09/cropped-SiteLogo.png`,
      author: 'Dave Rappoccio',
      artist: 'Dave Rappoccio',
      description:
        'The Draw Play is a labor of love by a football fan who needs something to do during the offseason. It exists as an outlet to make fun of and comment on the current state of the NFL and occasionally other things.',
      status: 1,
      lang: this.lang,
    };
  }

  async getMangaDetails(): Promise<Partial<Manga>> {
    return {
      title: TITLE,
      author: 'Dave Rappoccio',
      artist: 'Dave Rappoccio',
      status: 1,
      description:
        'The Draw Play is a labor of love by a football fan who needs something to do during the offseason. It exists as an outlet to make fun of and comment on the current state of the NFL and occasionally other things.',
      lang: this.lang,
    };
  }

  async getChapterList(): Promise<Chapter[]> {
    const res = await this.get(`${this.baseUrl}${ARCHIVE_PATH}`, { validateStatus: () => true });
    const $ = this.$(String(res.data));
    let year = '';
    const chapters: Chapter[] = [];
    let chapterIndex = 1;

    $('h3.year-title, tr:has(td.archive-title)').each((_, el) => {
      const $el = $(el);
      if ($el.is('h3')) {
        year = $el.text().trim();
        return;
      }
      const link = $el.find('td.archive-title > a').first();
      const href = link.attr('href');
      if (!href) return;
      const dateText = $el.find('td.archive-date').text().trim();
      const dateUpload = dateText ? Date.parse(`${dateText} ${year}`) : undefined;
      chapters.push({
        name: link.text().trim(),
        url: this.absUrl(href),
        chapterNumber: chapterIndex++,
        dateUpload: isNaN(dateUpload as number) ? undefined : dateUpload,
      });
    });

    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl), { validateStatus: () => true });
    const $ = this.$(String(res.data));
    const images: string[] = [];

    $('#comic img').each((_, el) => {
      const src = $(el).attr('src');
      if (src) images.push(this.absUrl(src));
    });

    $('.post-content .entry img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !images.includes(this.absUrl(src))) {
        images.push(this.absUrl(src));
      }
    });

    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
