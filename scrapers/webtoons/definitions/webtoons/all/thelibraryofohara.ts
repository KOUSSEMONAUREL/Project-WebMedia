import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio, CheerioAPI } from 'cheerio';

const dateFormat = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4})/;
const reverieLangRegex = /(French|Arabic|Italian|Indonesia|Spanish)/;

function parseDate(s: string): number {
  const normalized = s.replace('+00:00', '+0000');
  const m = dateFormat.exec(normalized);
  if (m) return new Date(m[1]).getTime();
  return 0;
}

export class TheLibraryOfOharaScraper extends BaseScraper {
  readonly name = 'The Library of Ohara';
  readonly baseUrl = 'https://thelibraryofohara.com';
  readonly lang: string = 'all';
  private siteLang = '';

  private popularMangaSelector(): string {
    switch (this.lang) {
      case 'en':
        return '#categories-7 ul li.cat-item-589813936,' +
          '#categories-7 ul li.cat-item-607613583,' +
          '#categories-7 ul li.cat-item-43972770,' +
          '#categories-7 ul li.cat-item-9363667,' +
          '#categories-7 ul li.cat-item-634609261,' +
          '#categories-7 ul li.cat-item-699200615,' +
          '#categories-7 ul li.cat-item-139757,' +
          '#categories-7 ul li.cat-item-22695,' +
          '#categories-7 ul li.cat-item-648324575';
      case 'id':
        return '#categories-7 ul li.cat-item-702404482, #categories-7 ul li.cat-item-699200615';
      case 'fr':
      case 'ar':
      case 'it':
        return '#categories-7 ul li.cat-item-699200615';
      default:
        return '#categories-7 ul li.cat-item-693784776, #categories-7 ul li.cat-item-699200615';
    }
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas: Manga[] = $(this.popularMangaSelector()).toArray().map(el => {
      const $el = $(el);
      const a = $el.find('a');
      return {
        title: a.text(),
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: '',
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const popular = await this.getPopular(1);
    const filtered = popular.mangas.filter(m => m.title.toLowerCase().includes(query.toLowerCase()));
    return { mangas: filtered, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1.page-title').text().replace('Category: ', '');
    const thumbnailUrl = this._chooseChapterThumbnail($, title) || '';
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, description: '' };
  }

  private _chooseChapterThumbnail($: CheerioAPI, mangaTitle: string): string | undefined {
    let imgEl: Cheerio<any> | null = null;
    if (mangaTitle.includes('Reverie')) {
      const articles = $('article').toArray();
      for (const article of articles) {
        const $a = $(article);
        const chapterTitle = $a.find('h2.entry-title a').text();
        if (chapterTitle.includes(this.siteLang) || (this.lang === 'en' && !reverieLangRegex.test(chapterTitle))) {
          imgEl = $a;
          break;
        }
      }
    }
    if (mangaTitle.includes('Chapter Secrets') && this.lang !== 'en') {
      const articles = $('article').toArray();
      for (const article of articles) {
        const $a = $(article);
        const chapterTitle = $a.find('h2.entry-title a').text();
        if ((this.lang === 'id' && chapterTitle.includes('Indonesia')) ||
            (this.lang === 'es' && !chapterTitle.includes('Indonesia'))) {
          imgEl = $a;
          break;
        }
      }
    }
    imgEl = imgEl || $('article:first-of-type').first();
    return imgEl ? this.absUrl(imgEl.find('img').attr('src') || '') : undefined;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const allChapters: Chapter[] = [];
    let currentUrl: string | null = mangaUrl;
    while (currentUrl) {
      const res = await this.get(currentUrl);
      let $ = this.$(res.data);
      const pageChapters: Chapter[] = $('article').toArray().map(el => {
        const $el = $(el);
        return {
          name: $el.find('h2.entry-title a').text(),
          url: this.absUrl($el.find('a.entry-thumbnail').attr('href') || ''),
          dateUpload: parseDate(
            $el.find('span.posted-on time').attr('datetime') || ''
          ) || undefined,
        };
      });
      if (pageChapters.length === 0) break;
      allChapters.push(...pageChapters);
      const nextLink = $('div.nav-previous a');
      if (nextLink.length === 0) break;
      currentUrl = this.absUrl(nextLink.attr('href') || '');
    }
    if (allChapters.length > 0 && allChapters[0].name.includes('Reverie')) {
      switch (this.lang) {
        case 'fr': return allChapters.filter(ch => ch.name.includes('French'));
        case 'ar': return allChapters.filter(ch => ch.name.includes('Arabic'));
        case 'it': return allChapters.filter(ch => ch.name.includes('Italian'));
        case 'id': return allChapters.filter(ch => ch.name.includes('Indonesia'));
        case 'es': return allChapters.filter(ch => ch.name.includes('Spanish'));
        default: return allChapters.filter(ch =>
          !ch.name.includes('French') &&
          !ch.name.includes('Arabic') &&
          !ch.name.includes('Italian') &&
          !ch.name.includes('Indonesia') &&
          !ch.name.includes('Spanish'));
      }
    }
    if (this.lang === 'es') {
      return allChapters.filter(ch => !ch.name.includes('Indonesia'));
    }
    return allChapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.entry-content').find('a img, img.size-full').toArray().map((el, i) => ({
      index: i,
      imageUrl: $(el).attr('data-orig-file') || '',
    }));
  }
}
