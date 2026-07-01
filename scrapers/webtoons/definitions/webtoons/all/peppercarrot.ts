import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const BASE_URL = 'https://www.peppercarrot.com';
const TITLE = 'Pepper&Carrot';
const AUTHOR = 'David Revoy';

const dateRegex = /\d{4}-\d{2}-\d{2}/;

export class PepperCarrotScraper extends BaseScraper {
  readonly name = TITLE;
  readonly baseUrl = BASE_URL;
  readonly lang = 'all';

  private langData: LangData[] = [];
  private selectedLangs: string[] = ['en'];

  async getPopular(page: number): Promise<SearchResult> {
    const mangas: Manga[] = [];

    for (const key of this.selectedLangs) {
      const lang = this.langData.find(l => l.key === key);
      if (lang) {
        mangas.push(this.langToManga(lang));
        const mft = this.getMiniFantasyTheaterEntry(lang);
        if (mft) mangas.push(mft);
      }
    }

    mangas.push(...this.getArtworkList());
    return { mangas, hasNextPage: false };
  }

  async getLatest(page: number): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    if (query) throw new Error('No search');
    return this.getPopular(page || 1);
  }

  async getMangaDetails(mangaUrl: string): Promise<Manga> {
    const key = mangaUrl;
    if (key.startsWith('#')) {
      return this.getArtworkEntry(key.substring(1));
    }
    if (key.startsWith('miniFantasyTheater')) {
      const langKey = key.split('#')[1];
      const lang = this.langData.find(l => l.key === langKey);
      if (lang) return this.getMiniFantasyTheaterEntry(lang)!;
      throw new Error('Language not found');
    }
    const lang = this.langData.find(l => l.key === key);
    if (lang) return this.langToManga(lang);
    throw new Error('Manga not found');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const key = mangaUrl;
    const url = key.startsWith('#')
      ? `${BASE_URL}/0_sources/0ther/${key.substring(1)}/low-res/`
      : key.startsWith('miniFantasyTheater')
        ? `${BASE_URL}/${key.split('#')[1]}/webcomics/miniFantasyTheater.html`
        : `${BASE_URL}/${key}/webcomics/peppercarrot.html`;

    const res = await this.get(url);
    const $ = this.$(res.data);

    if (key.startsWith('#')) {
      return this.parseArtwork(res, key.substring(1));
    }

    const translatedChapters: { number: number; el: any }[] = [];
    $('figure').each((i: number, el: any) => {
      if ($(el).hasClass('translated')) {
        translatedChapters.push({ number: $('figure').length - i, el });
      }
    });

    return translatedChapters.map(({ number, el }) => {
      const $el = $(el);
      const href = $el.find('a').first().attr('href')?.replace(BASE_URL, '') || '';
      const title = $el.find('img').first().attr('title') || '';
      const cleanName = title.substring(0, title.lastIndexOf('（') >= 0 ? title.lastIndexOf('（') : title.lastIndexOf('(')).trim();
      const dateText = $el.find('figcaption').first().text();
      const dateMatch = dateRegex.exec(dateText);
      const dateUpload = dateMatch ? this.parseDate(dateMatch[0]) : 0;

      return {
        url: href,
        name: cleanName,
        dateUpload: dateUpload,
        chapterNumber: number,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = chapterUrl.startsWith('http') ? chapterUrl : `${BASE_URL}${chapterUrl}`;

    if (url.endsWith('.jpg')) {
      return [{ index: 0, imageUrl: url }];
    }

    const res = await this.get(url);
    const $ = this.$(res.data);

    const urls = [
      ...$('.webcomic-page img').map((_: any, el: any) => $(el).attr('src')).get(),
      ...$('.mft-cv-image').map((_: any, el: any) => $(el).attr('src')).get(),
    ];

    const thumbnail = urls[0] && !urls[0].toLowerCase().includes('minifantasytheater')
      ? [urls[0].replace('P00.jpg', '.jpg')]
      : [];

    return [...thumbnail, ...urls].map((imgUrl, i) => ({
      index: i,
      imageUrl: imgUrl,
    }));
  }

  private parseArtwork(res: any, key: string): Chapter[] {
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    const baseDir = `/0_sources/0ther/${key}/low-res/`;

    $('a').get().reverse().forEach((el: any) => {
      const $el = $(el);
      const filename = $el.attr('href');
      if (!filename?.endsWith('.jpg')) return;

      const file = filename.replace('.jpg', '').replace('_by-David-Revoy', '');
      let fileStripped: string;
      let date: number;

      if (file.length >= 10 && dateRegex.test(file.substring(0, 10))) {
        fileStripped = file.substring(10);
        date = this.parseDate(file.substring(0, 10));
      } else {
        fileStripped = file;
        const lastModified = $el.next('text').first();
        date = lastModified ? this.parseDate(lastModified.text().trim()) : 0;
      }

      const name = fileStripped
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .trim()
        .replace(/^./, c => c.toUpperCase());

      chapters.push({
        url: baseDir + filename,
        name,
        dateUpload: date,
        chapterNumber: -2,
      });
    });

    return chapters;
  }

  private langToManga(lang: LangData): Manga {
    return {
      url: lang.key,
      title: lang.title || (lang.key === 'en' ? TITLE : `${TITLE} (${lang.key.toUpperCase()})`),
      author: AUTHOR,
      description: `Language: ${lang.name}\nTranslators: ${lang.translators}`,
      status: 1,
      thumbnailUrl: `${BASE_URL}/0_sources/0ther/artworks/low-res/2016-02-24_vertical-cover_remake_by-David-Revoy.jpg`,
      lang: this.lang,
    };
  }

  private getMiniFantasyTheaterEntry(lang: LangData): Manga | undefined {
    return {
      url: `miniFantasyTheater#${lang.key}`,
      title: `Mini Fantasy Theater${lang.key !== 'en' ? ` (${lang.key.toUpperCase()})` : ''}`,
      author: AUTHOR,
      description: 'A webcomic series featuring short stories set in the enchanting world of Pepper&Carrot. With its playful humor and whimsical tales, this collection of gag strips is perfect for audiences of all ages.',
      status: 1,
      thumbnailUrl: `${BASE_URL}/0_sources/0ther/artworks/low-res/2018-11-22_vertical-cover-book-three_by-David-Revoy.jpg`,
      lang: this.lang,
    };
  }

  private getArtworkEntry(key: string): Manga {
    const titles: Record<string, string> = {
      comissions: 'Commissions',
      eshop: 'Shop',
    };
    return {
      url: `#${key}`,
      title: titles[key] || key.charAt(0).toUpperCase() + key.slice(1),
      author: AUTHOR,
      status: 1,
      thumbnailUrl: `${BASE_URL}/0_sources/0ther/press/low-res/2015-10-12_logo_by-David-Revoy.jpg`,
      lang: this.lang,
    };
  }

  private getArtworkList(): Manga[] {
    return ['artworks', 'wallpapers', 'sketchbook', 'misc',
      'book-publishing', 'comissions', 'eshop', 'framasoft', 'press', 'references', 'wiki',
    ].map(k => this.getArtworkEntry(k));
  }

  private parseDate(dateStr: string): number {
    return Date.parse(dateStr) || 0;
  }
}

interface LangData {
  key: string;
  name: string;
  progress: string;
  translators: string;
  title?: string;
}
