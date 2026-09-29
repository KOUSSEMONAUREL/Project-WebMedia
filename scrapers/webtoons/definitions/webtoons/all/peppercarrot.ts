import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const TITLE = 'Pepper&Carrot';
const AUTHOR = 'David Revoy';
const DATE_REGEX = /\d{4}-\d{2}-\d{2}/;
const MFT_PREFIX = 'miniFantasyTheater#';
const ARTWORK_PREFIX = '#';
const ARTWORK_KEYS = [
  'artworks', 'wallpapers', 'sketchbook', 'misc', 'book-publishing',
  'comissions', 'eshop', 'framasoft', 'press', 'references', 'wiki',
];
const COVER = '0_sources/0ther/artworks/low-res/2016-02-24_vertical-cover_remake_by-David-Revoy.jpg';
const MFT_COVER = '0_sources/0ther/artworks/low-res/2018-11-22_vertical-cover-book-three_by-David-Revoy.jpg';
const MFT_DESCRIPTION =
  'A webcomic series featuring short stories set in the enchanting world of Pepper&Carrot. ' +
  'With its playful humor and whimsical tales, this collection of gag strips is perfect for ' +
  'audiences of all ages.';

interface LangData {
  key: string;
  name: string;
  translators: string[];
}

export class PepperCarrotScraper extends BaseScraper {
  readonly name = 'Pepper&Carrot';
  readonly baseUrl = 'https://www.peppercarrot.com';
  readonly lang = 'all';

  // Upstream pilote sa bibliotheque par 0_sources/langs.json: une entree
  // webcomic et une entree Mini Fantasy Theater par langue, plus les
  // galeries d'artworks. Le port initial codait en dur l'unique entree
  // /en/webcomics/peppercarrot.html, ce qui rendait inaccessibles toutes les
  // autres langues et laissait parseArtwork() et la branche .mft-cv-image de
  // getPageList() inatteignables.
  private langsPromise: Promise<LangData[]> | null = null;

  private async langs(): Promise<LangData[]> {
    this.langsPromise ??= this.loadLangs();
    return this.langsPromise;
  }

  private async loadLangs(): Promise<LangData[]> {
    const res = await this.get(`${this.baseUrl}/0_sources/langs.json`);
    const raw = res.data as Record<string, { name?: string; translators?: string[] }>;
    return Object.keys(raw)
      .map(key => ({
        key,
        name: raw[key]?.name ?? key,
        translators: Array.isArray(raw[key]?.translators) ? raw[key].translators : [],
      }))
      .sort((a, b) => {
        if (a.key === 'en') return -1;
        if (b.key === 'en') return 1;
        return a.key.localeCompare(b.key);
      });
  }

  // Comme upstream, l'identite stockee dans Manga.url est la cle, pas l'URL:
  // '#<artwork>' pour une galerie, 'miniFantasyTheater#<langue>' pour le MFT,
  // sinon la cle de langue du webcomic.
  private keyToUrl(key: string): string {
    if (key.startsWith(ARTWORK_PREFIX)) {
      return `${this.baseUrl}/0_sources/0ther/${key.substring(1)}/low-res/`;
    }
    if (key.startsWith(MFT_PREFIX)) {
      return `${this.baseUrl}/${key.substring(MFT_PREFIX.length)}/webcomics/miniFantasyTheater.html`;
    }
    return `${this.baseUrl}/${key}/webcomics/peppercarrot.html`;
  }

  private webcomicEntry(lang: LangData): Manga {
    return {
      title: lang.key === 'en' ? TITLE : `${TITLE} (${lang.key.toUpperCase()})`,
      url: lang.key,
      thumbnailUrl: `${this.baseUrl}/${COVER}`,
      lang: this.lang,
      author: AUTHOR,
      description: `Language: ${lang.name}\nTranslators: ${lang.translators.join(', ')}`,
      status: 1,
    };
  }

  private mftEntry(lang: LangData): Manga {
    return {
      title: lang.key === 'en' ? 'Mini Fantasy Theater' : `Mini Fantasy Theater (${lang.key.toUpperCase()})`,
      url: `${MFT_PREFIX}${lang.key}`,
      thumbnailUrl: `${this.baseUrl}/${MFT_COVER}`,
      lang: this.lang,
      author: AUTHOR,
      description: MFT_DESCRIPTION,
      status: 1,
    };
  }

  private artworkEntry(key: string): Manga {
    const titles: Record<string, string> = { comissions: 'Commissions', eshop: 'Shop' };
    return {
      title: titles[key] ?? key.charAt(0).toUpperCase() + key.substring(1),
      url: `${ARTWORK_PREFIX}${key}`,
      thumbnailUrl: `${this.baseUrl}/0_sources/0ther/press/low-res/2015-10-12_logo_by-David-Revoy.jpg`,
      lang: this.lang,
      author: AUTHOR,
      status: 1,
    };
  }

  async getPopular(): Promise<SearchResult> {
    const langs = await this.langs();
    const mangas: Manga[] = [];
    for (const lang of langs) {
      mangas.push(this.webcomicEntry(lang));
      mangas.push(this.mftEntry(lang));
    }
    for (const key of ARTWORK_KEYS) {
      mangas.push(this.artworkEntry(key));
    }
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    void query;
    return this.getPopular();
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const langs = await this.langs();
    if (mangaUrl.startsWith(ARTWORK_PREFIX)) {
      return this.artworkEntry(mangaUrl.substring(1));
    }
    if (mangaUrl.startsWith(MFT_PREFIX)) {
      const key = mangaUrl.substring(MFT_PREFIX.length);
      const lang = langs.find(l => l.key === key);
      return lang ? this.mftEntry(lang) : { title: 'Mini Fantasy Theater', url: mangaUrl, lang: this.lang };
    }
    const lang = langs.find(l => l.key === mangaUrl);
    return lang
      ? this.webcomicEntry(lang)
      : { title: TITLE, url: mangaUrl, lang: this.lang, author: AUTHOR };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.keyToUrl(mangaUrl);
    const response = await this.get(url);
    const requestUrl: string = response.request?.responseURL ?? url;
    if (new URL(requestUrl).pathname.split('/').filter(Boolean)[0] === '0_sources') {
      return this.parseArtwork(response.data, requestUrl);
    }
    return this.parseEpisodeList(response.data);
  }

  private parseEpisodeList(html: string): Chapter[] {
    const $ = this.$(html);
    const figures = $('figure').toArray();
    const total = figures.length;
    const chapters: Chapter[] = [];
    figures.forEach((el, index) => {
      const number = total - index;
      const $el = $(el);
      if (!$el.hasClass('translated')) return;
      const href = $el.find('a').first().attr('href') ?? '';
      const imgTitle = $el.find('img').first().attr('title') ?? '';
      const fullWidthIndex = imgTitle.lastIndexOf('（');
      let name: string;
      if (fullWidthIndex >= 0) {
        name = imgTitle.substring(0, fullWidthIndex).trimEnd();
      } else {
        const parenIndex = imgTitle.lastIndexOf('(');
        name = parenIndex >= 0 ? imgTitle.substring(0, parenIndex).trimEnd() : imgTitle.trimEnd();
      }
      const caption = $el.find('figcaption').first().text() ?? '';
      const dateMatch = DATE_REGEX.exec(caption);
      chapters.push({
        url: href.startsWith(this.baseUrl) ? href.substring(this.baseUrl.length) : href,
        name,
        chapterNumber: number,
        dateUpload: dateMatch ? this.parseDateUtc(dateMatch[0]) : 0,
      });
    });
    return chapters;
  }

  private parseArtwork(html: string, requestUrl: string): Chapter[] {
    const $ = this.$(html);
    const baseDir = requestUrl.startsWith(this.baseUrl)
      ? requestUrl.substring(this.baseUrl.length)
      : requestUrl;
    const chapters: Chapter[] = [];
    $($('a').toArray().reverse()).each((_, el: any) => {
      const filename: string = $(el).attr('href') ?? '';
      if (!filename.endsWith('.jpg')) return;
      const file = filename
        .substring(0, filename.length - '.jpg'.length)
        .replace(/_by-David-Revoy$/, '');
      let fileStripped: string;
      let date = 0;
      if (file.length >= 10 && DATE_REGEX.test(file.substring(0, 10))) {
        fileStripped = file.substring(10);
        date = this.parseDateUtc(file.substring(0, 10));
      } else {
        fileStripped = file;
        const sibling = el.nextSibling ?? el.next;
        const siblingText = sibling && sibling.type === 'text' ? String(sibling.data ?? '') : '';
        const dateMatch = DATE_REGEX.exec(siblingText);
        date = dateMatch ? this.parseDateUtc(dateMatch[0]) : 0;
      }
      const normalized = fileStripped
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .trim()
        .replace(/^./, c => c.toUpperCase());
      chapters.push({
        url: `${baseDir}${filename}`,
        name: normalized,
        chapterNumber: -2,
        dateUpload: date,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    if (chapterUrl.endsWith('.jpg')) {
      return [{ index: 0, imageUrl: this.absUrl(chapterUrl) }];
    }
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const urls: string[] = [];
    $('.webcomic-page img').each((_, el: any) => {
      const src = $(el).attr('src') ?? '';
      if (src) urls.push(src);
    });
    $('.mft-cv-image').each((_, el: any) => {
      const src = $(el).attr('src') ?? '';
      if (src) urls.push(src);
    });
    if (urls.length === 0) return [];
    const thumbnail = urls[0].toLowerCase().includes('minifantasytheater')
      ? []
      : [urls[0].replace('P00.jpg', '.jpg')];
    return [...thumbnail, ...urls].map((imageUrl, index) => ({ index, imageUrl }));
  }

  private parseDateUtc(date: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
    if (!match) return 0;
    const time = Date.UTC(
      parseInt(match[1], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[3], 10),
    );
    return Number.isNaN(time) ? 0 : time;
  }
}
