import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const ALL_DAYS = 7;
const THUMBNAIL_HOST = 'https://d2gfgyilxd7m0r.cloudfront.net';
const EPISODE_REGEX = /(?:viewPage|webtoonpay)\('(\d+)'\)/;
const TOTAL_PAGE_REGEX = /totalPage\s*=\s*(\d+)/;

interface BrowseItemDto {
  CONT_IDX?: string | null;
  TITLE?: string | null;
  THUMBNAIL?: string | null;
}

interface BrowseDto {
  totalpage: number;
  data?: BrowseItemDto[];
}

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

export class HypercomicScraper extends BaseScraper {
  readonly name = 'HYPERCOMIC';
  readonly baseUrl = 'https://play.hypercomic.io';
  readonly lang = 'en';

  private listItem($: CheerioAPI, link: Cheerio<Element>): Manga {
    return {
      title: link.find('.title').first().text().trim(),
      url: this.absUrl(link.attr('href') || ''),
      thumbnailUrl: this.absUrl(link.find('img').first().attr('src') || ''),
      lang: this.lang,
    };
  }

  private parseList($: CheerioAPI, selector: string): Manga[] {
    return $(selector)
      .toArray()
      .map(element => this.listItem($, $(element as Element)))
      .filter(manga => Boolean(manga.url && manga.title));
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get('/Webtoon/searchlist');
    const $ = this.$(String(res.data));
    return { mangas: this.parseList($, 'ul.search_list > li > a'), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({
      page: String(page),
      vtype: 'ajax',
      weekday: String(ALL_DAYS),
      lang: 'en',
    });
    const res = await this.get(`/Webtoon?${params.toString()}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });
    const data = parseJson<BrowseDto>(res.data);
    const mangas = (data.data ?? [])
      .map(item => {
        if (!item.CONT_IDX || !item.TITLE) return null;
        return {
          title: item.TITLE.trim(),
          url: this.absUrl(`/Webtoon/episode/${item.CONT_IDX}/1/`),
          thumbnailUrl: item.THUMBNAIL ? `${THUMBNAIL_HOST}/${item.THUMBNAIL}` : '',
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => manga !== null);
    return { mangas, hasNextPage: page < data.totalpage };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const body = new URLSearchParams({ searchval: query.trim() }).toString();
    const res = await this.client.post(`${this.baseUrl}/Webtoon/searchlist`, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${this.baseUrl}/Webtoon/searchlist`,
      },
    });
    const $ = this.$(String(res.data));
    return { mangas: this.parseList($, '#searchcont > li > a'), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.seriesId(mangaUrl);
    if (!id) return {};
    const res = await this.get(`/Webtoon/episode/${id}/1/`);
    const $ = this.$(String(res.data));
    const info = $('.info_text');
    return {
      title: $('.contents_wrap .text-xl').first().text().trim() || undefined,
      url: this.absUrl(`/Webtoon/episode/${id}/1/`),
      thumbnailUrl: this.absUrl($('.contents_wrap img').first().attr('src') || '') || undefined,
      author: $('.contents_wrap p.font-light').first().text().trim() || undefined,
      genre: $('.contents_wrap a[href="#"]')
        .toArray()
        .map(element => $(element).text().trim())
        .filter(Boolean)
        .join(', ') || undefined,
      description: this.description($, info),
      lang: this.lang,
    };
  }

  private description($: CheerioAPI, info: Cheerio<Element>): string | undefined {
    const paragraphs: string[] = [];
    for (const element of info.children().toArray()) {
      if ($(element).text() === 'Details') break;
      if ($(element).is('p')) paragraphs.push($(element).text());
    }
    return paragraphs.join('\n\n') || undefined;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.seriesId(mangaUrl);
    if (!id) return [];
    const first = await this.get(`/Webtoon/episode/${id}/1/`);
    const firstHtml = String(first.data);
    const pageCount = Number(TOTAL_PAGE_REGEX.exec(firstHtml)?.[1] ?? 1);
    const pages = [this.$(firstHtml)];
    for (let page = 2; page <= pageCount; page++) {
      const res = await this.get(`/Webtoon/episode/${id}/${page}/2/asc?vtype=ajax`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*; q=0.01',
        },
      });
      pages.push(this.$(String(res.data)));
    }
    return pages
      .flatMap(page$ => page$('.webtoon_list_type_06 a').toArray().map(element => page$(element as Element)))
      .map(link => this.toChapter(id, link))
      .filter((chapter): chapter is Chapter => chapter !== null)
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    return $('.webtoon_view img')
      .toArray()
      .map((element, index) => ({
        index,
        imageUrl: this.absUrl($(element).attr('src') || ''),
      }))
      .filter(page => Boolean(page.imageUrl));
  }

  private toChapter(seriesId: string, link: Cheerio<Element>): Chapter | null {
    const onclick = link.attr('onclick') || '';
    const episodeId = EPISODE_REGEX.exec(onclick)?.[1];
    if (!episodeId) return null;
    const title = link.find('.title').first().text().trim();
    const locked = onclick.includes('webtoonpay');
    return {
      name: locked ? `🔒 ${title}` : title,
      url: this.absUrl(`/Webtoon/episodeview/${seriesId}/${episodeId}/1/1/asc`),
    };
  }

  private seriesId(mangaUrl: string): string | undefined {
    const segments = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean);
    if (segments[0] !== 'Webtoon' || !['episode', 'episodeview'].includes(segments[1])) return undefined;
    return /^\d+$/.test(segments[2] ?? '') ? segments[2] : undefined;
  }
}
