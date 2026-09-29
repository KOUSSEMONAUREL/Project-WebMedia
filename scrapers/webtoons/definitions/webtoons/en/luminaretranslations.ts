import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type * as cheerio from 'cheerio';

interface EntryResponse {
  data: EntryData[];
  meta: { total: number };
}

interface EntryData {
  title: string;
  slug: string;
  type: string | null;
  cover_image: string | null;
}

interface InfoRow {
  label: string;
  value: string;
}

interface ChapterData {
  id: number;
  number: number;
  title: string | null;
  subtitle: string | null;
  published_at: string | null;
}

const EXCLUDED_TYPES = new Set(['novel', 'light_novel', 'web_novel']);
const PAGE_SIZE = 24;

export class LuminareTranslationsScraper extends BaseScraper {
  readonly name = 'Luminare Translations';
  readonly baseUrl = 'https://luminaretranslations.com';
  readonly lang = 'en';

  private get apiUrl(): string {
    return `${this.baseUrl}/wp-json/yarnovel/v1`;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchSeries(page, '', 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchSeries(page, '', 'latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.searchSeries(page, query);
  }

  private async searchSeries(page: number, query: string, sort?: string): Promise<SearchResult> {
    const params = new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE), type: 'manga' });
    if (query.trim()) params.set('search', query.trim());
    if (sort) params.set('sort', sort);
    const res = await this.get(`${this.apiUrl}/series?${params.toString()}`);
    const result: EntryResponse = typeof res.data === 'string' ? JSON.parse(res.data) as EntryResponse : res.data as EntryResponse;
    const mangas: Manga[] = result.data
      .filter(entry => !entry.type || !EXCLUDED_TYPES.has(entry.type))
      .map(entry => ({
        url: `${this.baseUrl}/series/${entry.slug}`,
        title: entry.title,
        thumbnailUrl: entry.cover_image || '',
        lang: this.lang,
      }));
    return { mangas, hasNextPage: page * PAGE_SIZE < result.meta.total };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const info = this.parseInfoRows($);
    const statusText = (info['Status'] || '').toLowerCase();
    const status = statusText === 'ongoing' ? 1 : statusText === 'completed' ? 2 : statusText === 'hiatus' ? 3 : statusText === 'dropped' ? 3 : 0;
    return {
      title: $('h1').first().text().trim(),
      thumbnailUrl: this.absUrl($('meta[property=og:image]').first().attr('content') || ''),
      description: $('#series-description').first().text().trim() || undefined,
      author: info['Author'] || undefined,
      artist: info['Artist'] || undefined,
      genre: info['Genre'] || undefined,
      status,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const seriesSlug = mangaUrl.split('/').filter(Boolean).pop() || '';
    const raw = this.xDataArray($, 'chapters');
    const list: ChapterData[] = JSON.parse(raw) as ChapterData[];
    return list
      .map(entry => {
        const num = entry.number % 1 === 0 ? Math.trunc(entry.number) : entry.number;
        const base = entry.title?.trim() || `Chapter ${num}`;
        const sub = entry.subtitle?.trim();
        const ts = entry.published_at ? Date.parse(entry.published_at) : NaN;
        return {
          url: `${this.baseUrl}/series/${seriesSlug}/${entry.id}`,
          name: sub ? `${base} - ${sub}` : base,
          chapterNumber: entry.number,
          dateUpload: isNaN(ts) ? undefined : ts,
        };
      })
      .sort((a, b) => (b.chapterNumber || 0) - (a.chapterNumber || 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const images = $('img.reader-page[data-src]');
    const server = images.first().attr('data-server-id');
    return images
      .filter((_: any, el: any) => $(el).attr('data-server-id') === server)
      .map((i: number, el: any) => ({ index: i, imageUrl: this.absUrl($(el).attr('data-src') || '') }))
      .get();
  }

  private xDataArray($: cheerio.CheerioAPI, key: string): string {
    const xData = ($('section[x-data*=chapters:]').first().attr('x-data') || '')
      .split('\n')
      .map((line: string) => line.trim());
    const line = xData.find((l: string) => l.startsWith(`${key}:`)) || '';
    return line.slice(key.length + 1).trim().replace(/,$/, '');
  }

  private parseInfoRows($: cheerio.CheerioAPI): Record<string, string> {
    const rows: InfoRow[] = JSON.parse(this.xDataArray($, 'infoRows')) as InfoRow[];
    const info: Record<string, string> = {};
    for (const row of rows) info[row.label] = row.value;
    return info;
  }
}
