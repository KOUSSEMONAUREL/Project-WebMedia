import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const IMG_REGEX = /background-image: url\("(.+?)"\);/;

function parseRokuDate(dateStr: string): number {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

export class RokuHentaiScraper extends BaseScraper {
  readonly name = 'Roku Hentai';
  readonly baseUrl = 'https://rokuhentai.com';
  readonly lang = 'all';
  readonly useThumbnails = false;

  private offsets: Record<string, string> = {};

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/`);
    url.searchParams.set('q', query);
    if (page > 1) {
      const offset = this.offsets[`search:${query}`];
      if (offset) {
        url.pathname = '/_search';
        url.searchParams.set('p', offset);
      }
    }
    const res = await this.get(url.toString());
    return this._parsePopularPage(res, query);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = page === 1 ? this.baseUrl : `${this.baseUrl}/_search?p=${this.offsets['popular'] || ''}`;
    const res = await this.get(url);
    return this._parsePopularPage(res);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const img = $('.site-manga-info .mdc-card__media').first();
    const titles = $('.site-manga-info__info h6');
    const bgStyle = img.attr('style') || '';
    const bgMatch = IMG_REGEX.exec(bgStyle);
    return {
      title: titles.first().text() || undefined,
      url: mangaUrl,
      thumbnailUrl: bgMatch ? bgMatch[1] : undefined,
      description: titles.eq(1).text() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    // mangaUrl format: /path/ID#COUNT,TIMESTAMP
    const afterHash = mangaUrl.split('#')[1] || '';
    const id = mangaUrl.substring(mangaUrl.lastIndexOf('/') + 1).split('#')[0];
    const count = afterHash.split(',')[0];
    const timestamp = afterHash.split(',')[1];
    const dateUpload = timestamp ? parseInt(timestamp) : undefined;
    // fetch title from the details page
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.site-manga-card__title--primary').first().text() || $('.site-manga-info__info h6').first().text() || 'Chapter';
    return [{
      name: title,
      url: id,
      dateUpload,
      chapterNumber: 0,
      scanlator: `${count}P`,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    // chapterUrl is the ID (path segment before #)
    // scanlator stores "COUNTP" — we need the count
    // Since scanlator isn't passed to getPageList, we extract from the manga URL
    // The manga URL is stored in chapterUrl as the ID, but we need count
    // For simplicity, we fetch the manga page to get the count from the URL
    const res = await this.get(`${this.baseUrl}/${chapterUrl}/0#top-to-bottom`);
    const $ = this.$(res.data);
    const card = $('.mdc-card > .site-popunder-ad-slot').first();
    const infoText = card.find('.mdc-typography--caption:last-child').text();
    const count = parseInt(infoText.split(' images ')[0]) || 0;
    const path = this.useThumbnails ? 'page-thumbnails' : 'pages';
    const pages: Page[] = [];
    for (let i = 0; i < count; i++) {
      pages.push({ index: i, imageUrl: `${this.baseUrl}/_images/${path}/${chapterUrl}/${i}.jpg` });
    }
    return pages;
  }

  private _parseManga(el: any, $: any): Manga {
    const $el = $(el);
    const infoEl = $el.find('.mdc-typography--caption:last-child').first();
    const infoText = infoEl.text();
    const infoParts = infoText.split(' images ');
    const imageCount = infoParts[0] || '0';
    const dateStr = infoParts[1] || '';
    const dateTs = dateStr ? parseRokuDate(dateStr) : 0;
    const link = $el.find('a').first();
    const href = this.absUrl(link.attr('href') || '');
    const baseHref = href.substring(0, href.lastIndexOf('/'));
    const title = $el.find('.site-manga-card__title--primary').first().text();
    const mediaEl = $el.find('.mdc-card__media').first();
    const bgStyle = mediaEl.attr('style') || '';
    const bgMatch = IMG_REGEX.exec(bgStyle);
    return {
      title,
      url: `${baseHref}#${imageCount},${dateTs}`,
      thumbnailUrl: bgMatch ? bgMatch[1] : '',
      lang: this.lang,
    };
  }

  private _parsePopularPage(res: any, query?: string): SearchResult {
    const contentType = res.headers['content-type'] || '';
    let mangas: Manga[];
    if (contentType.includes('text/html')) {
      const $ = this.$(res.data);
      mangas = $('.mdc-card > .site-popunder-ad-slot').toArray().map(el => this._parseManga(el, $));
    } else {
      const data = res.data as { mangaCards?: string[] };
      const cards = data.mangaCards || [];
      mangas = cards.map((cardHtml: string) => {
        const $ = this.$(cardHtml);
        const el = $('.site-popunder-ad-slot').first();
        return this._parseManga(el, $);
      });
    }
    if (mangas.length === 0) return { mangas, hasNextPage: false };
    const last = mangas[mangas.length - 1];
    const lastId = last.url.substring(last.url.lastIndexOf('/') + 1).split('#')[0];
    if (query !== undefined) {
      this.offsets[`search:${query}`] = lastId;
    } else {
      this.offsets['popular'] = lastId;
    }
    return { mangas, hasNextPage: mangas.length > 0 };
  }
}
