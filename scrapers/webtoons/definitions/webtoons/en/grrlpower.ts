import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const COMIC_AUTHOR = 'David Barrack';
const STARTING_YEAR = 2010;
const THUMBNAIL_URL = 'https://static.tvtropes.org/pmwiki/pub/images/rsz_grrl_power.png';

const MONTHS_ABBR: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function parseArchiveDate(dateStr: string): number {
  const m = dateStr.trim().match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (!m) return 0;
  const month = MONTHS_ABBR[m[1].toLowerCase()];
  if (month === undefined) return 0;
  return Date.UTC(parseInt(m[3], 10), month, parseInt(m[2], 10));
}

export class GrrlPowerScraper extends BaseScraper {
  readonly name = 'Grrl Power Comic';
  readonly baseUrl = 'https://www.grrlpowercomic.com';
  readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    const mangas: Manga[] = [
      {
        title: 'Grrl Power',
        url: '/archive',
        thumbnailUrl: THUMBNAIL_URL,
        lang: this.lang,
        author: COMIC_AUTHOR,
        artist: COMIC_AUTHOR,
        status: 1,
        genre: 'superhero, humor, action',
        description:
          'Grrl Power is a comic about a crazy nerdette that becomes a superheroine. Humor, action, cheesecake, beefcake, explosions, and maybe some drama. Possibly ninjas.',
      },
    ];
    return { mangas, hasNextPage: false };
  }

  async getSearch(_query: string, _page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: search not supported`);
  }

  async getMangaDetails(_mangaUrl: string): Promise<Partial<Manga>> {
    const { mangas } = await this.getPopular();
    return { ...mangas[0] };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const currentYear = new Date().getFullYear();
    const chapters: Chapter[] = [];
    for (let year = STARTING_YEAR; year <= currentYear; year++) {
      const res = await this.get(`/archive/?archive_year=${year}`);
      const $ = this.$(res.data);
      $('.archive-date').each((_, el: any) => {
        const dateStr = `${$(el).text().trim()} ${year}`;
        const link = $(el).next().find('a').first();
        if (!link.length) return;
        const href = link.attr('href') || '';
        if (!href) return;
        chapters.push({
          name: link.text().trim(),
          url: this.absUrl(href),
          dateUpload: parseArchiveDate(dateStr),
        });
      });
    }
    return chapters.sort((a, b) => (b.dateUpload || 0) - (a.dateUpload || 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const img = $('div#comic img').first();
    const src = img.attr('src') || '';
    if (!src) return [];
    return [{ index: 0, imageUrl: this.absUrl(src) }];
  }
}
