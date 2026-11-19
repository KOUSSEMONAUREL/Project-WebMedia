import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Manga, MangaStatus, Chapter, Page, SearchResult } from '../../../engine/types';

const INCLUDED_CATEGORIES = [
  'Series',
  'Manga',
  'Manhwa',
  'Manhua',
  'Doujinshi',
  'Web Novel (JP)',
  'Web Novel (KR)',
  'Web Novel (CN)',
];
const EXCLUDED_CATEGORIES = ['Anime', 'Novel', 'Novela', 'Chapter'];
const MAX_MANGA_RESULTS = 20;

interface BloggerText {
  $t: string;
}

interface BloggerLink {
  rel: string;
  href: string;
}

interface BloggerEntry {
  title?: BloggerText;
  published?: BloggerText;
  updated?: BloggerText;
  category?: { term: string }[];
  link?: BloggerLink[];
  content?: BloggerText;
  'media$thumbnail'?: { url: string };
}

interface BloggerFeed {
  feed?: {
    entry?: BloggerEntry[];
    'openSearch$totalResults'?: BloggerText;
  };
}

export class MurimScanScraper extends BaseScraper {
  readonly name = 'MurimScan';
  readonly baseUrl = 'https://www.murimscans.site';
  readonly lang = 'en';

  private categoryQuery(query = ''): string {
    const included = INCLUDED_CATEGORIES.map(category => `label:"${category}" `).join('');
    const excluded = EXCLUDED_CATEGORIES.map(category => `-label:"${category}" `).join('');
    return `{${included}} ${excluded}${query.trim()}`.trim();
  }

  private feedUrl(page: number, query = '', orderBy?: string): string {
    const url = new URL(`${this.baseUrl}/feeds/posts/default`);
    url.searchParams.set('alt', 'json');
    if (orderBy) url.searchParams.set('orderby', orderBy);
    url.searchParams.set('max-results', String(MAX_MANGA_RESULTS + 1));
    url.searchParams.set('start-index', String(MAX_MANGA_RESULTS * (page - 1) + 1));
    url.searchParams.set('q', this.categoryQuery(query));
    return url.toString();
  }

  private async fetchFeed(url: string): Promise<BloggerEntry[]> {
    const res = await this.get(url, { headers: { Accept: 'application/json, text/plain, */*' } });
    const body = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as BloggerFeed;
    return body.feed?.entry ?? [];
  }

  private async fetchChapterEntries(feedUrl: string): Promise<BloggerEntry[]> {
    const allEntries: BloggerEntry[] = [];
    for (;;) {
      const url = new URL(feedUrl);
      url.searchParams.set('start-index', String(allEntries.length + 1));
      url.searchParams.set('max-results', '150');
      const res = await this.get(url.toString(), { headers: { Accept: 'application/json, text/plain, */*' } });
      const body = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as BloggerFeed;
      const entries = body.feed?.entry ?? [];
      allEntries.push(...entries);
      const total = Number.parseInt(body.feed?.['openSearch$totalResults']?.$t ?? '', 10);
      if (entries.length === 0 || !Number.isFinite(total) || allEntries.length >= total) break;
    }
    return allEntries;
  }

  private thumbnail($: CheerioAPI, entry: BloggerEntry): string {
    const thumbnail = entry['media$thumbnail']?.url;
    if (thumbnail) {
      return thumbnail
        .replace(/\/s.+?-c\//, '/w600/')
        .replace(/=s(?!.*=s).+?-c$/, '=w600');
    }
    const content = entry.content?.$t ?? '';
    if (!content) return '';
    return $(content).find('img').first().attr('src') ?? '';
  }

  private entryUrl(entry: BloggerEntry): string {
    return (entry.link ?? []).find(link => link.rel === 'alternate')?.href ?? '';
  }

  private entryToManga($: CheerioAPI, entry: BloggerEntry): Manga | undefined {
    const title = entry.title?.$t?.trim() ?? '';
    const url = this.entryUrl(entry);
    if (!title || !url) return undefined;
    return {
      title,
      url,
      thumbnailUrl: this.thumbnail($, entry),
      lang: this.lang,
    };
  }

  private parseEntries(entries: BloggerEntry[]): SearchResult {
    const $ = this.$('');
    const mangas = entries
      .map(entry => this.entryToManga($, entry))
      .filter((manga): manga is Manga => Boolean(manga));
    const hasNextPage = entries.length === MAX_MANGA_RESULTS + 1;
    if (hasNextPage) mangas.pop();
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getLatest(page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const entries = await this.fetchFeed(this.feedUrl(page, '', 'published'));
    return this.parseEntries(entries);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const entries = await this.fetchFeed(this.feedUrl(page, query));
    return this.parseEntries(entries);
  }

  private statusToManga(status: string): MangaStatus {
    const value = status.toLowerCase().trim();
    if (['ongoing', 'en curso', 'en emisión', 'em lançamento', 'activo', 'ativo', 'lançando'].includes(value)) return 1;
    if (['completed', 'completo', 'finalizado'].includes(value)) return 0;
    if (['hiatus', 'pausado'].includes(value)) return 3;
    if (['cancelled', 'dropped', 'dropado', 'abandonado', 'cancelado'].includes(value)) return 2;
    return 3;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const main = $('main').first();
    const genres = $('h1.entry-title + div > span:first-child, h1.entry-title ~ div a[rel=tag]')
      .toArray()
      .map(element => $(element).text().trim())
      .filter(Boolean);

    return {
      title: $('h1.entry-title').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: this.absUrl(main.find('img').first().attr('src') ?? ''),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: $('.entry-content').first().text().trim() || undefined,
      author: $('span#author').first().text().trim() || undefined,
      status: this.statusToManga($('h1.entry-title + div > span:nth-child(3)').first().text()),
      lang: this.lang,
    };
  }

  private chapterFeedLabel($: CheerioAPI, mangaTitle: string): string {
    const clwd = $('#clwd > script').html() ?? '';
    const clwdMatch = clwd.match(/clwd\.run\(["'](.*?)["']\)/);
    if (clwdMatch) return clwdMatch[1];

    const latest = $('#latest > script').html() ?? '';
    const latestMatch = latest.match(/label\s*=\s*'([^']+)'/);
    if (latestMatch) return latestMatch[1];

    const oldScript = $('#myUL > script').attr('src') ?? '';
    const oldMatch = oldScript.match(/([^']+)\?/);
    if (oldMatch) return oldMatch[1];

    return mangaTitle;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const mangaTitle = $('h1.entry-title').first().text().trim();
    const label = this.chapterFeedLabel($, mangaTitle);

    const url = new URL(`${this.baseUrl}/feeds/posts/default/-/${encodeURIComponent(label)}`);
    url.searchParams.set('alt', 'json');
    const entries = await this.fetchChapterEntries(url.toString());

    return entries
      .filter(entry => (entry.category ?? []).some(category => category.term === 'Chapter'))
      .map(entry => {
        const date = entry.published?.$t ?? entry.updated?.$t ?? '';
        const dateUpload = date ? Date.parse(date) : Number.NaN;
        return {
          name: entry.title?.$t?.trim() ?? 'Chapter',
          url: this.entryUrl(entry),
          dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
        } as Chapter;
      })
      .filter(chapter => Boolean(chapter.url));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    const pages: Page[] = [];
    $('.chapter-raw-content').each((_: number, element) => {
      if ($(element).prevAll('.chapter-raw-content').length > 0) return;
      $(element).find('img[src]').each((__: number, img) => {
        const src = $(img).attr('src');
        if (src) pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
      });
    });
    return pages;
  }
}
