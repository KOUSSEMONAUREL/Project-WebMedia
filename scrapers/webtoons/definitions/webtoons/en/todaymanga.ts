import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseStatus(text: string | undefined): MangaStatus {
  switch (text?.trim().toLowerCase()) {
    case 'complete': return 0;
    case 'on going': return 1;
    default: return 3;
  }
}

type Sel = ReturnType<CheerioAPI>;

export class TodaymangaScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor() {
    super();
    this.name = 'Today Manga';
    this.baseUrl = 'https://todaymanga.com';
    this.lang = 'en';
  }

  // ------------------------- Popular -------------------------

  async getPopular(page = 1): Promise<SearchResult> {
    const url = this.withPage('/category/most-popular', page);
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $('section > main > div.series-info')
      .toArray()
      .map(el => this.popularMangaFromElement($(el)));
    return { mangas, hasNextPage: this.hasNextPage($) };
  }

  // ------------------------- Latest -------------------------

  async getLatest(page = 1): Promise<SearchResult> {
    const url = this.withPage('/category/recent', page);
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $('ul.series > li')
      .toArray()
      .map(el => this.latestMangaFromElement($(el)));
    return { mangas, hasNextPage: this.hasNextPage($) };
  }

  // ------------------------- Search -------------------------

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const base = this.baseUrl;
    let url: string;
    if (query.trim()) {
      const q = encodeURIComponent(query.trim());
      url = `${base}/search?q=${q}`;
      if (page > 1) url += `&page=${page}`;
    } else {
      url = this.withPage('/category/most-popular', page);
    }
    const res = await this.get(url);
    const $ = this.$(res.data);
    let mangas = $('section div.serie')
      .toArray()
      .map(el => this.popularMangaFromElement($(el)));
    if (mangas.length === 0) {
      mangas = $('ul.series > li')
        .toArray()
        .map(el => this.latestMangaFromElement($(el)));
    }
    return { mangas, hasNextPage: this.hasNextPage($) };
  }

  // ------------------------- Details -------------------------

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const title = $('.series-info h1').first().text().trim();
    const thumbnailUrl = this.imgAttr($('.series-info > .series-img > img').first()) ||
      this.imgAttr($('.series-info img').first());
    const genre = $('.series-info *[itemprop=genre] > a')
      .toArray()
      .map(el => $(el).text().trim())
      .filter(Boolean)
      .join(', ');
    const author = $('.series-info span[itemprop=author] > span')
      .toArray()
      .map(el => $(el).text().trim())
      .filter(Boolean)
      .join(', ');

    let statusEl: Sel | null = null;
    for (const el of $('.series-info *').toArray()) {
      const ownText = $(el).clone().children().remove().end().text().trim();
      if (ownText.includes('Status')) {
        const next = $(el).next();
        if (next.length) {
          statusEl = next;
          break;
        }
      }
    }

    const summary = $('.series-summary').first();
    let description = '';
    if (summary.length) {
      summary.contents().toArray().forEach(node => {
        if (node.type === 'text') {
          description += node.data ?? '';
        } else if (node.type === 'tag' && node.name === 'br') {
          description += '\n';
        }
      });
      const styled = summary.find('div[style]').first();
      if (styled.length) {
        description += '\n\n' + styled.text();
      }
    }
    description = description.replace(/\n{3,}/g, '\n\n').trim();

    return {
      title: title || undefined,
      url: mangaUrl,
      thumbnailUrl,
      lang: this.lang,
      genre: genre || undefined,
      author: author || undefined,
      status: parseStatus(statusEl?.text()),
      description: description || undefined,
    };
  }

  // ------------------------- Chapters -------------------------

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('#chapList > li')
      .toArray()
      .map(el => {
        const $el = $(el);
        const link = $el.find('a').first();
        const name = $el.find('strong').first().text().trim() || link.text().trim();
        const dateText = $el.find('span.muted').first().text().trim() || undefined;
        let dateUpload: number | undefined;
        if (dateText) {
          if (dateText.toLowerCase().includes('ago')) {
            dateUpload = this.parseRelativeDate(dateText);
          } else if (DATE_FORMAT_RE.test(dateText)) {
            const parsed = Date.parse(dateText);
            dateUpload = Number.isNaN(parsed) ? undefined : parsed;
          }
        }
        return {
          name,
          url: this.absUrl(link.attr('href') || ''),
          dateUpload,
        };
      });
  }

  // ------------------------- Pages -------------------------

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('.chapter-content > img[data-index]')
      .toArray()
      .map((el, index) => ({
        index: Number($(el).attr('data-index')) || index,
        imageUrl: this.imgAttr($(el)),
      }))
      .sort((a, b) => a.index - b.index);
  }

  // ------------------------- Utilities -------------------------

  private withPage(path: string, page: number): string {
    if (page <= 1) return path;
    return `${path}?page=${page}`;
  }

  private hasNextPage($: CheerioAPI): boolean {
    return $('.pagination > ul > li.active + li:has(a)').length > 0;
  }

  private popularMangaFromElement(el: Sel): Manga {
    const title = el.find('.series-name').first().text().trim();
    const url = el.find('a[href]').first().attr('href') || '';
    return {
      title,
      url: this.absUrl(url),
      thumbnailUrl: this.imgAttr(el.find('img').first()),
      lang: this.lang,
    };
  }

  private latestMangaFromElement(el: Sel): Manga {
    const title = el.find('.series-name').first().text().trim();
    const url = el.find('a[title][href]').first().attr('href') || el.find('a[href]').first().attr('href') || '';
    return {
      title,
      url: this.absUrl(url),
      thumbnailUrl: this.imgAttr(el.find('img').first()),
      lang: this.lang,
    };
  }

  private imgAttr(el: Sel): string {
    if (el.attr('data-lazy-src')) return this.absUrl(el.attr('data-lazy-src') || '');
    if (el.attr('data-src')) return this.absUrl(el.attr('data-src') || '');
    return this.absUrl(el.attr('src') || '');
  }

  private parseRelativeDate(text: string): number | undefined {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const amountText = text.split(' ')[0]?.replace('one', '1').replace('a', '1');
    const amount = Number(amountText);
    if (!Number.isFinite(amount)) return undefined;
    const result = new Date(dayStart);
    if (text.includes('second')) result.setSeconds(result.getSeconds() - amount);
    else if (text.includes('minute')) result.setMinutes(result.getMinutes() - amount);
    else if (text.includes('hour')) result.setHours(result.getHours() - amount);
    else if (text.includes('day')) result.setDate(result.getDate() - amount);
    else if (text.includes('week')) result.setDate(result.getDate() - amount * 7);
    else if (text.includes('month')) result.setMonth(result.getMonth() - amount);
    else if (text.includes('year')) result.setFullYear(result.getFullYear() - amount);
    return result.getTime();
  }
}