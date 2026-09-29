import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const MANGA_URL = '/category/darkscience/';
const MANGA_THUMBNAIL =
  'https://dresdencodak.com/wp-content/uploads/2019/03/DC_CastIcon_Kimiko.png';
const MANGA_AUTHOR = 'Sen (A. Senna Diaz)';
const MANGA_DESCRIPTION =
  'Scientist Kimiko Ross has a problem: her money\u2019s gone and a bank exploded her house. ' +
  'With no place else to go, she travels to Nephilopolis, the city of giants \u2013 built from ' +
  'the ruins of an ancient war and a fading memory of tomorrow.\n' +
  'Follow our cyborg hero as she attempts to survive the bureaucratic behemoth with a little ' +
  '\u201chelp\u201d from her \u201cfriends.\u201d And what exactly is Dark Science anyway?\n' +
  'Support the comic on Patreon: https://www.patreon.com/dresdencodak';
const MANGA_GENRE = 'Science Fiction, Mystery, LGBT+';

const CHAPTER_NUMBER_REGEX = /Dark Science #(\d+)/;
const CHAPTER_DATE_REGEX = /\/(\d\d\d\d\/\d\d\/\d\d)\//;

function parseArchiveDate(ymd: string): number | undefined {
  const parts = ymd.split('/');
  if (parts.length !== 3) return undefined;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return undefined;
  return Date.UTC(year, month - 1, day);
}

export class DarkScienceScraper extends BaseScraper {
  readonly name = 'Dark Science';
  readonly baseUrl = 'https://dresdencodak.com';
  readonly lang = 'en';

  private buildManga(): Manga {
    return {
      url: MANGA_URL,
      title: this.name,
      thumbnailUrl: MANGA_THUMBNAIL,
      lang: this.lang,
      author: MANGA_AUTHOR,
      artist: MANGA_AUTHOR,
      description: MANGA_DESCRIPTION,
      genre: MANGA_GENRE,
      status: 1,
    };
  }

  async getPopular(): Promise<SearchResult> {
    return { mangas: [this.buildManga()], hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not supported`);
  }

  async getSearch(_query: string, _page?: number): Promise<SearchResult> {
    throw new Error(`${this.name}: getSearch() not supported`);
  }

  async getMangaDetails(_mangaUrl: string): Promise<Partial<Manga>> {
    return this.buildManga();
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    let lastNum = 0;
    let archiveUrl: string | null = mangaUrl || MANGA_URL;

    while (archiveUrl !== null) {
      const res = await this.get(archiveUrl);
      const $ = this.$(res.data);
      const nextHref = $('#nav-below .nav-previous > a').first().attr('href') ?? null;

      $('#content article header > h2 > a').each((_, el) => {
        const anchor = $(el);
        const title = anchor.text().trim();
        const href = anchor.attr('href') ?? '';
        const numMatch = CHAPTER_NUMBER_REGEX.exec(title);
        const num = numMatch ? parseFloat(numMatch[1]) : lastNum + 0.01;
        lastNum = num;
        const dateMatch = CHAPTER_DATE_REGEX.exec(href);
        chapters.push({
          name: title,
          url: this.absUrl(href),
          chapterNumber: num,
          dateUpload: dateMatch ? parseArchiveDate(dateMatch[1]) : undefined,
        });
      });

      archiveUrl = nextHref ? this.absUrl(nextHref) : null;
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const src = $('article.post img.aligncenter').first().attr('src') ?? '';
    return [{ index: 0, imageUrl: this.absUrl(src) }];
  }
}
