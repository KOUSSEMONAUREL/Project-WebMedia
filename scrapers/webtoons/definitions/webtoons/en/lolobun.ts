import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface StatusDto {
  errorCode: number;
  msg: string | null;
}

interface ResponseDto<T> {
  status: StatusDto;
  data: T | null;
}

interface SearchDto {
  HasMore: boolean;
  Items: SearchItemDto[];
}

interface SearchItemDto {
  EntityId: number;
  Title: string;
  Cover: string | null;
}

const COVER_URL = 'https://osrs.sfacg.com/web/comic/images/Logo';
const CHAPTER_NUMBER_REGEX = /chapter\s*(\d+(?:\.\d+)?)/i;

export class LolobunScraper extends BaseScraper {
  readonly name = 'LoLoBun';
  readonly baseUrl = 'https://www.lolobun.com';
  readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    const seen = new Set<string>();
    $('.section-item:has(a.name[href^=/c/])').each((_, el) => {
      const link = $(el).find('a.name').first();
      const href = link.attr('href') || '';
      const id = href.split('/').filter(Boolean).pop() || '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      mangas.push({
        url: `${this.baseUrl}/c/${id}`,
        title: link.text().trim(),
        thumbnailUrl: this.absUrl($(el).find('img.cover').first().attr('src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    throw new Error('UnsupportedOperationException');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) return this.getPopular(page);
    const url = `${this.baseUrl}/ajax/Common.ashx?op=searchWorks&q=${encodeURIComponent(query.trim())}&type=comic&pi=${page - 1}`;
    const res = await this.get(url);
    const result = this.requireData<ResponseDto<SearchDto>>(res.data).data as SearchDto;
    return {
      mangas: result.Items.map(item => ({
        url: `${this.baseUrl}/c/${item.EntityId}`,
        title: item.Title,
        thumbnailUrl: item.Cover ? (item.Cover.startsWith('http') ? item.Cover : `${COVER_URL}/${item.Cover}`) : '',
        lang: this.lang,
      })),
      hasNextPage: result.HasMore,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const info = ($('.header-item-info .info').first().text() || '').split('·').map(s => s.trim());
    const statusText = (info[0] || '').toLowerCase();
    return {
      title: $('.header-item-info .name').first().text().trim(),
      thumbnailUrl: this.absUrl($('img.header-item-cover').first().attr('src') || ''),
      description: $('#comic-desc').first().text().trim() || undefined,
      status: statusText === 'ongoing' ? 1 : statusText === 'completed' ? 2 : 0,
      genre: info.slice(1).join(', ') || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const items = $('.catalog-list .catalog-item');
    const latestDate = this.parseCalendarDate($('.lastest-update-time').first().text().trim());
    let previousNumber = 0;
    let extrasSincePrevious = 0;
    const chapters: Chapter[] = [];
    items.each((index: number, el: any) => {
      const $el = $(el);
      const link = $el.find('.title a').first();
      const title = link.text().trim();
      const href = link.attr('href') || '';
      if (!title || !href) return;
      const match = CHAPTER_NUMBER_REGEX.exec(title);
      let chapterNumber: number;
      if (match) {
        previousNumber = parseFloat(match[1]);
        extrasSincePrevious = 0;
        chapterNumber = previousNumber;
      } else {
        extrasSincePrevious++;
        chapterNumber = previousNumber + extrasSincePrevious / 100;
      }
      const locked = $el.find('.icon-box img[src*=lock]').length > 0;
      chapters.push({
        url: this.absUrl(href),
        name: locked ? `🔒 ${title}` : title,
        chapterNumber,
        dateUpload: index === items.length - 1 ? latestDate : undefined,
      });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapId = chapterUrl.split('/').filter(Boolean).pop() || '';
    const body = new URLSearchParams({ chapId }).toString();
    const res = await this.post(`${this.baseUrl}/ajax/comic.ashx?op=getChapterPic`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const images = this.requireData<ResponseDto<string[]>>(res.data).data as string[];
    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }

  private requireData<T extends ResponseDto<unknown>>(data: T | string): T {
    const parsed: T = typeof data === 'string' ? JSON.parse(data) as T : data;
    if (parsed.data == null) throw new Error(parsed.status.msg || `Request failed with code ${parsed.status.errorCode}`);
    return parsed;
  }

  private parseCalendarDate(text: string): number | undefined {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
    if (!m) return undefined;
    return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10)).getTime();
  }
}
