import { createHash } from 'node:crypto';
import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const API_URL = 'https://sg.mangatoon.mobi';
const H5_URL = 'https://h5.mangatoon.mobi';
const SIGN_KEY = '66c10a61bd916c23f3b33810d3785d17';
const LIST_PAGE_SIZE = 18;
const URL_LANG = 'en';
const POSTER_SUFFIX = /(jpg)-poster(.*)\d+?$/;
const CONTENT_ID_REGEX = /(?:content_id=|\/detail\/|^\/)(\d+)/;

interface DataDto<T> {
  data?: T | null;
}

interface AuthorDto {
  name: string;
}

interface TagDto {
  name: string;
}

interface DetailDto {
  title: string;
  content_description?: string | null;
  author?: AuthorDto | null;
  tags?: TagDto[];
  is_end: boolean;
  image_url?: string | null;
}

interface EpisodeDto {
  id: number;
  title: string;
  weight: number;
  open_at: number;
  is_fee: boolean;
}

interface PictureDto {
  url?: string | null;
}

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

export class MangaToonScraper extends BaseScraper {
  readonly name = 'MangaToon (Limited)';
  readonly baseUrl = 'https://mangatoon.mobi';
  readonly lang = 'all';

  private get webUrl(): string {
    return `${this.baseUrl}/${URL_LANG}`;
  }

  private listUrl(path: string, page: number): string {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page - 1));
    const qs = params.toString();
    return `${this.webUrl}/genre/${path}${qs ? `?${qs}` : ''}`;
  }

  private parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('div.genre-content div.items a')
      .toArray()
      .map(element => {
        const $el = $(element);
        return {
          title: $el.find('div.content-title').text().trim(),
          thumbnailUrl: this.normalPosterUrl(this.imgAttr($el.find('img'))),
          url: this.absUrl($el.attr('href') || ''),
          lang: this.lang,
        };
      })
      .filter(manga => Boolean(manga.url));
    return { mangas, hasNextPage: $('span.next').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl('hot', page));
    return this.parseList(String(res.data));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl('new', page));
    const result = this.parseList(String(res.data));
    return { mangas: result.mangas, hasNextPage: result.mangas.length >= LIST_PAGE_SIZE };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = `${this.webUrl}/search?word=${encodeURIComponent(query)}`;
    const res = await this.client.get(this.absUrl(url), {
      validateStatus: status => status === 404 || (status >= 200 && status < 300),
    });
    if (res.status === 404) return { mangas: [], hasNextPage: false };
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const $ = this.$(String(res.data));
    const mangas: Manga[] = $('div.comics-result div.recommend-item')
      .toArray()
      .map(element => {
        const $el = $(element);
        const link = $el.find('a').first();
        const href = link.attr('href') || '';
        if (!href.includes('mangatoon')) return null;
        return {
          title: $el.find('div.recommend-comics-title').text().trim(),
          thumbnailUrl: this.normalPosterUrl(this.imgAttr($el.find('img'))),
          url: this.absUrl(href),
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => manga !== null);
    return { mangas, hasNextPage: $('span.next').length > 0 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const contentId = this.contentId(mangaUrl);
    if (!contentId) return {};
    const detail = await this.api<DetailDto>('/api/content/detail', contentId);
    if (!detail) return {};
    const thumbnail = detail.image_url?.replace('http://', 'https://');
    const status: MangaStatus = detail.is_end ? 0 : 1;
    return {
      title: detail.title,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: thumbnail ?? '',
      author: detail.author?.name?.trim() || undefined,
      description: detail.content_description ?? undefined,
      genre: (detail.tags ?? []).map(tag => tag.name).join(', ') || undefined,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const contentId = this.contentId(mangaUrl);
    if (!contentId) return [];
    const episodes = await this.api<EpisodeDto[]>('/api/content/episodes', contentId);
    return (episodes ?? [])
      .filter(episode => !episode.is_fee)
      .map(episode => ({
        name: episode.title,
        url: this.absUrl(`/${URL_LANG}/watch/${contentId}/${episode.id}`),
        chapterNumber: episode.weight,
        dateUpload: episode.open_at * 1000,
      }))
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const episodeId = chapterUrl.split('/').filter(Boolean).pop() ?? '';
    if (!episodeId) return [];
    const pictures = await this.api<PictureDto[]>('/api/cartoons/pictures', episodeId);
    return (pictures ?? [])
      .map(picture => this.toImageUrl(picture.url))
      .filter((url): url is string => Boolean(url))
      .map((imageUrl, index) => ({ index, imageUrl }));
  }

  private async api<T>(path: string, id: string): Promise<T | null> {
    const query = new Map<string, string>([
      ['_', String(Math.floor(Date.now() / 1000))],
      ['_language', URL_LANG],
      ['_platform', 'web'],
      ['_preference', 'girl'],
      ['_v', '3.07.00'],
      ['_webp', 'false'],
      ['id', id],
    ]);
    const queryString = [...query.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const sign = createHash('md5').update(path + queryString + SIGN_KEY).digest('hex');
    const res = await this.client.get(`${API_URL}${path}?sign=${sign}&${queryString}`, {
      headers: {
        Accept: 'application/json',
        Referer: `${H5_URL}/`,
      },
    });
    return parseJson<DataDto<T>>(res.data).data ?? null;
  }

  private contentId(url: string): string | undefined {
    return CONTENT_ID_REGEX.exec(url)?.[1];
  }

  private toImageUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    return url
      .replace('/encrypted/', '/watermark/')
      .replace('.webp', '.jpg')
      .replace('.e.pic.', '-e-pic.')
      .replace('.c.pic.', '-c-pic.')
      .replace('http://', 'https://');
  }

  private imgAttr($el: Cheerio<Element>): string {
    const dataSrc = $el.attr('data-src');
    return this.absUrl(dataSrc || $el.attr('src') || '');
  }

  private normalPosterUrl(url: string): string {
    return url ? url.replace(POSTER_SUFFIX, '$1') : '';
  }
}
