import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const LOGO_EN = 'https://i.imgur.com/HODJlt9.jpg';
const LOGO_FR = 'https://i.imgur.com/I7ps9zS.jpg';
const AUTHOR_EN = 'Mark Nightingale';
const AUTHOR_FR = 'Thomas Gx';
const ARTIST = 'Etienne Issartial';
const SUMMARY_EN = 'The blog relating the daily life of web agency developers.';
const SUMMARY_FR = 'Le blog qui raconte la vie des codeurs';
const NOTE = '\n\nNote: This entry includes all the chapters published in';

const dateRegex = /\d{4}\/\d{2}\/\d{2}/;
const pageRegex = /\d+/;

export class CommitStripScraper extends BaseScraper {
  readonly name = 'Commit Strip';
  readonly baseUrl = 'https://www.commitstrip.com';
  readonly lang: string;
  private readonly siteLang: string;

  constructor(lang = 'en', siteLang = 'en') {
    super();
    this.lang = lang;
    this.siteLang = siteLang;
  }

  get currentYear(): number {
    return new Date().getFullYear();
  }

  private createManga(year: number): Manga {
    const title = `${this.name} (${year})`;
    const url = `${this.baseUrl}/${this.siteLang}/${year}`;
    const thumbnailUrl = this.lang === 'fr' ? LOGO_FR : LOGO_EN;
    const author = this.lang === 'fr' ? AUTHOR_FR : AUTHOR_EN;
    const completed = year !== this.currentYear;
    const description = this.lang === 'fr'
      ? `${SUMMARY_FR} ${NOTE} ${year}`
      : `${SUMMARY_EN} ${NOTE} ${year}`;
    return {
      title,
      url,
      thumbnailUrl,
      author,
      description,
      lang: this.lang,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const mangas: Manga[] = [];
    for (let year = this.currentYear; year >= 2012; year--) {
      mangas.push(this.createManga(year));
    }
    return { mangas, hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const popular = await this.getPopular(1);
    const filtered = popular.mangas.filter(m => m.title.toLowerCase().includes(query.toLowerCase()));
    return { mangas: filtered, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return { url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const pagesRes = await this.get(mangaUrl);
    const $pages = this.$(pagesRes.data);
    const pagesText = $pages('.wp-pagenavi .pages').first().text() || '1';
    const totalPages = parseInt(pageRegex.exec(pagesText)?.[0] || '1', 10);

    const allChapters: Chapter[] = [];

    for (let page = 1; page <= totalPages; page++) {
      const res = await this.get(`${mangaUrl}/page/${page}`);
      if (res.status !== 200) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const $ = this.$(res.data);
      const chapterElements = $('.excerpt a').toArray();
      const pageChapters: Chapter[] = chapterElements.map(el => {
        const $el = $(el);
        const href = $el.attr('href') || '';
        const url = `${this.baseUrl}/${this.siteLang}${href.split(this.baseUrl)[1] || href}`;
        const dateMatch = dateRegex.exec(url);
        let dateUpload: number | undefined;
        if (dateMatch) {
          const parts = dateMatch[0].split('/');
          dateUpload = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
        }
        const name = $el.find('span').text();
        return { name, url, dateUpload };
      });
      allChapters.push(...pageChapters);
    }

    const unique = allChapters.filter((ch, i, arr) => arr.findIndex(c => c.url === ch.url) === i);
    const total = unique.length;
    return unique.map((ch, i) => ({
      ...ch,
      chapterNumber: total - i,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const img = $('.entry-content p img').first();
    const imageUrl = this.absUrl(img.attr('src') || '');
    return [{ index: 0, imageUrl }];
  }
}
