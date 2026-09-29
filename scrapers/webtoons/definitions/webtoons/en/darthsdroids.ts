import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const MANGA_AUTHOR = 'David Morgan-Mar & Co.';
const MANGA_DESCRIPTION =
  'What if Star Wars as we know it didn\u2019t exist, but instead the plot of the movies was ' +
  'being made up on the spot by players of a Tabletop Game?\n\n' +
  'Well, for one, the results might actually make a lot more sense, from an out-of-story point of view\u2026';
const MANGA_GENRE = 'Campaign Comic, Comedy, Space Opera, Science Fiction';

const ONGOING_ARCHIVE = '/archive.html';
const PUBLISHED_REGEX = /Published\:\s+(\w+,\s+\d+\s+\w+,\s+\d+\;\s+\d+\:\d+\:\d+\s+\w+)/;
const PAGE_DATE_REGEX = /(\w+),\s+(\d+)\s+(\w+),\s+(\d+);\s+(\d+):(\d+):(\d+)\s+(\w+)/;
const CHAPTER_DATE_REGEX = /(\d{1,2}) (\w+), (\d{4})/;

const MONTHS_SHORT: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const MONTHS_LONG: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

const TZ_OFFSETS: Record<string, number> = {
  PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4,
  UTC: 0, GMT: 0,
};

function parseChapterDate(text: string): number | undefined {
  const m = CHAPTER_DATE_REGEX.exec(text.trim());
  if (!m) return undefined;
  const month = MONTHS_SHORT[m[2]];
  const day = Number(m[1]);
  const year = Number(m[3]);
  if (month === undefined || !day || !year) return undefined;
  return Date.UTC(year, month, day);
}

function parsePublishedDate(text: string): number {
  const m = PAGE_DATE_REGEX.exec(text.trim());
  if (!m) return 0;
  const month = MONTHS_LONG[m[3]];
  if (month === undefined) return 0;
  const offset = TZ_OFFSETS[m[8]] ?? 0;
  return (
    Date.UTC(Number(m[4]), month, Number(m[2]), Number(m[5]), Number(m[6]), Number(m[7])) -
    offset * 3_600_000
  );
}

export class DarthsDroidsScraper extends BaseScraper {
  readonly name = 'Darths & Droids';
  readonly baseUrl = 'https://www.darthsanddroids.net';
  readonly lang = 'en';

  private thumbnailUrlForTitle(nthManga: number): string {
    switch (nthManga) {
      case 0: return `${this.baseUrl}/cast/QuiGon.jpg`;
      case 1: return `${this.baseUrl}/cast/Anakin2.jpg`;
      case 2: return `${this.baseUrl}/cast/ObiWan3.jpg`;
      case 3: return `${this.baseUrl}/cast/JarJar2.jpg`;
      case 4: return `${this.baseUrl}/cast/Leia4.jpg`;
      case 5: return `${this.baseUrl}/cast/Han5.jpg`;
      case 6: return `${this.baseUrl}/cast/Luke6.jpg`;
      case 7: return `${this.baseUrl}/cast/Cassian.jpg`;
      case 8: return `${this.baseUrl}/cast/C3PO4.jpg`;
      case 9: return `${this.baseUrl}/cast/Finn7.jpg`;
      case 10: return `${this.baseUrl}/cast/Han4.jpg`;
      case 11: return `${this.baseUrl}/cast/Hux8.jpg`;
      default: return `${this.baseUrl}/cast/Vader4.jpg`;
    }
  }

  private buildManga(archiveUrl: string, title: string, status: 1 | 2, nthManga: number): Manga {
    return {
      url: archiveUrl,
      title,
      thumbnailUrl: this.thumbnailUrlForTitle(nthManga),
      lang: this.lang,
      author: MANGA_AUTHOR,
      artist: MANGA_AUTHOR,
      description: MANGA_DESCRIPTION,
      genre: MANGA_GENRE,
      status,
    };
  }

  async getPopular(): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/archive.html`);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    let nextTitle = this.name;
    let nthManga = 0;

    const rows = $('div.text table.text tr').toArray();
    for (const row of rows) {
      const $row = $(row);
      if ($row.find('th').length > 0) {
        nextTitle = `${this.name} ${$row.find('th').first().text().trim()}`;
      } else {
        const archiveHref = $row.find('td[colspan="3"] > a').first().attr('href');
        if (archiveHref) {
          mangas.push(this.buildManga(archiveHref, nextTitle, 2, nthManga++));
        } else {
          mangas.push(this.buildManga(ONGOING_ARCHIVE, nextTitle, 1, nthManga));
          break;
        }
      }
    }

    return { mangas, hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not supported`);
  }

  async getSearch(_query: string, _page?: number): Promise<SearchResult> {
    throw new Error(`${this.name}: getSearch() not supported`);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const popular = await this.getPopular();
    const target = this.absUrl(mangaUrl);
    const found = popular.mangas.find((m) => this.absUrl(m.url) === target);
    if (found) return found;
    return {
      url: mangaUrl,
      author: MANGA_AUTHOR,
      artist: MANGA_AUTHOR,
      description: MANGA_DESCRIPTION,
      genre: MANGA_GENRE,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    let pageDate = 0;
    $('br + i').each((_, el) => {
      if (pageDate) return;
      const m = PUBLISHED_REGEX.exec($(el).text());
      if (m) pageDate = parsePublishedDate(m[1]);
    });

    const chapters: Chapter[] = [];
    let i = 0;
    $('div.text table.text tr').each((_, el) => {
      const $row = $(el);
      const tds = $row.find('td');
      if (tds.length === 0) return;
      const datedAnchor = tds.eq(2).find('a').first();
      if (datedAnchor.length > 0) {
        chapters.push({
          name: datedAnchor.text().trim(),
          url: this.absUrl(datedAnchor.attr('href') ?? ''),
          chapterNumber: i++,
          dateUpload: parseChapterDate(tds.eq(0).text()),
        });
      } else if ($row.find('td[colspan]').length === 0) {
        const datelessAnchor = tds.eq(0).find('a').first();
        if (datelessAnchor.length > 0) {
          chapters.push({
            name: datelessAnchor.text().trim(),
            url: this.absUrl(datelessAnchor.attr('href') ?? ''),
            chapterNumber: i++,
            dateUpload: pageDate || undefined,
          });
        }
      }
    });

    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.center img')
      .toArray()
      .map((el, index) => ({
        index,
        imageUrl: this.absUrl($(el).attr('src') ?? ''),
      }));
  }
}
