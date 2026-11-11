import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const RELATIVE_DATE_REGEX = /(\d+)([smhdwMy]) ago/;
const CHAPTER_ID_REGEX = /CHAPTER_ID\s*=\s*(\d+)/;

function parseRelativeDate(value: string): number | undefined {
  const match = RELATIVE_DATE_REGEX.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const now = new Date();
  switch (match[2]) {
    case 's': now.setSeconds(now.getSeconds() - amount); break;
    case 'm': now.setMinutes(now.getMinutes() - amount); break;
    case 'h': now.setHours(now.getHours() - amount); break;
    case 'd': now.setDate(now.getDate() - amount); break;
    case 'w': now.setDate(now.getDate() - amount * 7); break;
    case 'M': now.setMonth(now.getMonth() - amount); break;
    case 'y': now.setFullYear(now.getFullYear() - amount); break;
    default: return undefined;
  }
  return now.getTime();
}

function parseStatus(value: string | undefined): MangaStatus {
  switch (value?.trim().toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'on-hold': return 3;
    case 'canceled':
    case 'cancelled': return 2;
    default: return undefined;
  }
}

export class ManhuaPlusTopScraper extends BaseScraper {
  readonly name = 'ManhuaPlus.top';
  readonly baseUrl = 'https://manhuaplus.top';
  readonly lang = 'en';

  private parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas = $('div.items div.item').toArray().map(el => {
      const link = $(el).find('h3 a').first();
      const img = $(el).find('div.image img').first();
      return {
        title: link.text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('data-original') || img.attr('src') || ''),
        lang: this.lang,
      };
    }).filter(manga => manga.title && manga.url);
    return { mangas, hasNextPage: $('ul.pagination li.active + li').length > 0 };
  }

  private async listPage(page: number, sort: string): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/all-manga/${page}/?sort=${encodeURIComponent(sort)}`);
    return this.parseList(res.data);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.listPage(page, 'views');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.listPage(page, 'latest-updated');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    const url = `${this.baseUrl}/search/${page}/?keyword=${encodeURIComponent(term)}`;
    const res = await this.get(url);
    return this.parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const info = $('article#item-detail').first();
    if (info.length === 0) return { url: mangaUrl, lang: this.lang };
    const title = info.find('h1.title-detail').first().text().trim();
    const author = info.find('li.author p.col-xs-8 a').toArray()
      .map(el => $(el).text().trim()).filter(Boolean).join(', ');
    const genre = info.find('li.kind p.col-xs-8 a').toArray()
      .map(el => $(el).text().trim()).filter(Boolean).join(', ');
    const thumbnail = info.find('div.col-image img').first();
    const description = info.find('div.detail-content p').toArray()
      .map(el => $(el).text().trim()).filter(Boolean).join('\n');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(thumbnail.attr('src') || ''),
      author: author || undefined,
      genre: genre || undefined,
      description: description || undefined,
      status: parseStatus(info.find('li.status p.col-xs-8').first().text()),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('div.list-chapter li.row:not(.heading)').toArray().map(el => {
      const link = $(el).find('a').first();
      return {
        name: link.text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        dateUpload: parseRelativeDate($(el).find('div.col-xs-4').first().text()),
      };
    }).filter(chapter => chapter.name && chapter.url);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const script = $('script:contains(CHAPTER_ID)').first().text();
    const chapterId = CHAPTER_ID_REGEX.exec(script)?.[1];
    if (!chapterId) return [];
    const ajax = await this.post(`${this.baseUrl}/ajax/image/list/chap/${chapterId}`, '', {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: this.absUrl(chapterUrl),
      },
    });
    const payload = ajax.data as { html?: string };
    if (!payload.html) return [];
    const images = this.$(payload.html);
    return images('div.page-chapter > img').toArray().map((el, index) => {
      const img = images(el);
      return {
        index,
        imageUrl: this.absUrl(img.attr('data-original') || img.attr('src') || ''),
      };
    }).filter(page => page.imageUrl);
  }
}

export default ManhuaPlusTopScraper;
