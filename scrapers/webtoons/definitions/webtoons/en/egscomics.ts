import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const THUMBNAIL_URL =
  'https://static.tumblr.com/8cee5e83d26a8a96ad5e51b67f2e340e/j8ipbno/fXFoj0zh9/tumblr_static_1f2fhwjyya74gsgs888g8k880.png';

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function parseFullDate(dateStr: string): number | undefined {
  const m = dateStr.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return undefined;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return undefined;
  return Date.UTC(parseInt(m[3], 10), month, parseInt(m[2], 10));
}

export class EgsComicsScraper extends BaseScraper {
  readonly name = 'El Goonish Shive';
  readonly baseUrl = 'https://www.egscomics.com';
  readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    const mangas: Manga[] = [
      {
        title: this.name,
        url: '/comic/archive',
        thumbnailUrl: THUMBNAIL_URL,
        lang: this.lang,
        author: 'Dan Shive',
        artist: 'Dan Shive',
        status: 1,
        description:
          'El Goonish Shive is a comic about a group of teenagers who face ' +
          'both real life and bizarre, supernatural situations. \n\n' +
          'It is a comedy mixed with drama and is recommended for audiences thirteen ' +
          'and older.',
      },
      {
        title: `${this.name}: NewsPaper`,
        url: '/egsnp/archive',
        thumbnailUrl: THUMBNAIL_URL,
        lang: this.lang,
        author: 'Dan Shive',
        artist: 'Dan Shive',
        status: 1,
        description:
          'El Goonish Shive is a comic about a group of teenagers who face ' +
          'both real life and bizarre, supernatural situations. \n\n' +
          'It is a comedy mixed with drama and is recommended for audiences thirteen ' +
          'and older. \n\n' +
          "EGS:NP is a subsection with short stories that generally aren't canon " +
          'unless stated',
      },
      {
        title: `${this.name} Sketchbook`,
        url: '/sketchbook/archive',
        thumbnailUrl: THUMBNAIL_URL,
        lang: this.lang,
        author: 'Dan Shive',
        artist: 'Dan Shive',
        status: 1,
        description:
          'El Goonish Shive is a comic about a group of teenagers who face ' +
          'both real life and bizarre, supernatural situations. \n\n' +
          'It is a comedy mixed with drama and is recommended for audiences thirteen ' +
          'and older. \n\n' +
          'The Sketchbook section is full of one-shot gags, sketches, comics that ' +
          "don't fit elsewhere.",
      },
    ];
    return { mangas, hasNextPage: false };
  }

  async getSearch(_query: string, _page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const { mangas } = await this.getPopular();
    const found = mangas.find((m) => mangaUrl.endsWith(m.url));
    if (found) return { ...found };
    return {};
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('select[name=comic] option').each((_, el: any) => {
      const value = $(el).attr('value') || '';
      if (!/^(comic|egsnp|sketchbook)/.test(value)) return;
      const chapterNumber = $(el).prevAll().length;
      const text = $(el).text().trim();
      const parts = text.split(' - ');
      const name = parts.length > 1 ? parts.slice(1).join(' - ') : text;
      const dateUpload = parseFullDate(parts[0]);
      chapters.push({
        name,
        url: `/${value}`,
        chapterNumber,
        dateUpload,
      });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('#cc-comic').each((i: number, el: any) => {
      const src = $(el).attr('src') || '';
      if (!src) return;
      pages.push({ index: i, imageUrl: this.absUrl(src) });
    });
    return pages;
  }
}
