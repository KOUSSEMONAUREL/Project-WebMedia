import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject } from '../../../engine/nextjs';

interface ReaderPageDto {
  page: number;
  ext: string;
}

interface ReaderDto {
  galleryId: string;
  pages: ReaderPageDto[];
  imgDir: string;
  server: number;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function isReaderPage(value: Json): value is JsonObject & ReaderPageDto {
  return isJsonObject(value) && typeof value.page === 'number' && typeof value.ext === 'string';
}

function isReader(value: Json): value is JsonObject & ReaderDto {
  return isJsonObject(value)
    && typeof value.galleryId === 'string'
    && typeof value.imgDir === 'string'
    && typeof value.server === 'number'
    && Array.isArray(value.pages)
    && value.pages.every(isReaderPage);
}

export class HentaiRunScraper extends BaseScraper {
  readonly name = 'HentaiRun';
  readonly baseUrl = 'https://hentairun.com';
  readonly lang = 'all';

  private searchUrl(query: string, sort: string, page: number): string {
    const url = new URL('/search/', this.baseUrl);
    const term = query.trim().toLowerCase();
    if (term) url.searchParams.set('q', term);
    url.searchParams.set('sort', sort);
    if (page > 1) url.searchParams.set('page', String(page));
    return url.toString();
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.searchUrl('', 'popular', page));
    return this.parseListing(String(res.data));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.searchUrl('', 'latest', page));
    return this.parseListing(String(res.data));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(this.searchUrl(query, 'latest', page));
    return this.parseListing(String(res.data));
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('a[aria-label][href^="/gallery/"]').toArray().map(element => {
      const link = $(element);
      const href = link.attr('href') ?? '';
      const label = link.attr('aria-label') ?? '';
      if (!href || !label) return undefined;
      return {
        title: decodeEntities(label),
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(link.find('img').first().attr('src') ?? ''),
        lang: this.lang,
      } as Manga;
    }).filter((manga): manga is Manga => Boolean(manga));
    const hasNextPage = $('a, button').toArray().some(element => $(element).text().trim() === 'Next ›');
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const artists = this.info($, 'Artists');
    const groups = this.info($, 'Groups');
    const description = ['Parodies', 'Characters', 'Groups', 'Languages', 'Category']
      .map(tag => [tag, this.info($, tag).join(', ')] as const)
      .filter(([, value]) => value.length > 0)
      .map(([tag, value]) => `${tag}: ${value}`);
    const pages = this.pagesCount($);
    if (pages) description.push(`Pages: ${pages}`);
    return {
      title: $('h1').first().text().trim(),
      url: this.absUrl(mangaUrl),
      thumbnailUrl: this.absUrl($('a[href^="/view/"] img').first().attr('src') ?? ''),
      lang: this.lang,
      author: (artists.length > 0 ? artists : groups).join(', ') || undefined,
      artist: artists.join(', ') || undefined,
      genre: this.info($, 'Tags').join(', ') || undefined,
      description: description.join('\n\n') || undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const id = new URL(this.absUrl(mangaUrl)).pathname.split('/').filter(Boolean).pop() ?? '';
    if (!id) return [];
    return [{
      name: 'Chapter',
      url: `${this.baseUrl}/view/${id}/1/`,
      scanlator: this.info($, 'Groups').join(', ') || undefined,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const reader = extractNextJsHtml(String(res.data), isReader);
    if (!reader || !isReader(reader)) return [];
    const host = new URL(this.baseUrl).host;
    return reader.pages.map((page, index) => ({
      index,
      imageUrl: `https://m${reader.server}.${host}/${reader.imgDir}/${reader.galleryId}/${page.page}.${page.ext}`,
    }));
  }

  private info($: CheerioAPI, heading: string): string[] {
    const values = $('span').toArray()
      .filter(element => $(element).text().trim() === heading)
      .flatMap(element => $(element).parent().children('div').children('a').toArray().map(link => $(link).children('span').first().text().trim()))
      .filter(Boolean);
    return [...new Set(values)];
  }

  private pagesCount($: CheerioAPI): string {
    return $('span').toArray()
      .filter(element => $(element).text().trim() === 'Pages:')
      .map(element => $(element).next('span').text().trim())
      .find(Boolean) ?? '';
  }
}

export default HentaiRunScraper;
