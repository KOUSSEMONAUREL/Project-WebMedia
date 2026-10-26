import { BaseScraper } from '../../../engine/base';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject } from '../../../engine/nextjs';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface WebtoonClubChapter {
  chapterNumber: string;
  slug: string;
  title?: string | null;
  date?: string | null;
}

interface WebtoonClubChapters {
  chapters?: WebtoonClubChapter[];
}

interface BookJsonLd {
  '@type'?: string;
  name?: string;
  image?: string;
  description?: string;
  alternateName?: string[];
  author?: Array<{ name?: string }>;
  genre?: string[];
  creativeWorkStatus?: string;
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing':
    case 'incomplete':
      return 1;
    case 'completed':
    case 'complete':
      return 0;
    case 'hiatus':
      return 2;
    case 'cancelled':
    case 'canceled':
      return 2;
    default:
      return undefined;
  }
}

function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export class WebtoonclubScraper extends BaseScraper {
  readonly name = 'WebtoonClub';
  readonly baseUrl = 'https://webtoonclub.com';
  readonly lang = 'en';

  private cards(html: string): SearchResult {
    const $ = this.$(html);
    const mangas = $('a[href^="/webtoon/"]:has(img[data-cover])').toArray().map(el => {
      const link = $(el);
      const img = link.find('img[data-cover]').first();
      const srcset = img.attr('srcset') ?? '';
      const last = srcset.split(',').pop()?.trim().split(/\s+/)[0] ?? '';
      const thumb = last || img.attr('src') || '';
      return {
        title: link.find('h3').first().text().trim(),
        url: link.attr('href') ?? '',
        thumbnailUrl: thumb ? this.absUrl(thumb) : '',
        lang: this.lang,
      };
    }).filter(manga => manga.title && manga.url);
    return {
      mangas,
      hasNextPage: $('a[aria-label="Go to next page"]').length > 0,
    };
  }

  private async listing(query: Record<string, string>, page: number): Promise<SearchResult> {
    const params = new URLSearchParams(query);
    if (page > 1) params.set('page', String(page));
    const res = await this.get(`/webtoons?${params.toString()}`);
    return this.cards(res.data as string);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.listing({ sort: 'popular' }, page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.listing({ sort: 'latest' }, page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params: Record<string, string> = {};
    if (query.trim()) params.search = query.trim();
    return this.listing(params, page);
  }

  private bookFromHtml(html: string): BookJsonLd | null {
    const $ = this.$(html);
    const raw = $('script[type="application/ld+json"]').first().text();
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isJsonObject(parsed)) return null;
      const graph = parsed['@graph'];
      if (!Array.isArray(graph)) return null;
      for (const entry of graph) {
        if (isJsonObject(entry) && entry['@type'] === 'Book') return entry as BookJsonLd;
      }
    } catch {
      return null;
    }
    return null;
  }

  private fact($: ReturnType<BaseScraper['$']>, name: string): string | undefined {
    const dt = $('dt').filter((_i, el) => $(el).text().trim() === name).first();
    const value = dt.next('dd').text().trim();
    return value || undefined;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const html = res.data as string;
    const $ = this.$(html);
    const book = this.bookFromHtml(html);
    const title = $('h1').first().text().trim() || book?.name || '';
    const statusText = this.fact($, 'Status');
    const synopsis = $('p.whitespace-pre-line').first().text().trim();
    const description = synopsis || book?.description || '';
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: book?.image ?? '',
      author: (book?.author ?? []).map(a => a.name ?? '').filter(Boolean).join(', ') || undefined,
      genre: (book?.genre ?? []).join(', ') || undefined,
      status: parseStatus(statusText) ?? parseStatus(book?.creativeWorkStatus),
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const comicId = $('[data-comic-id]').first().attr('data-comic-id');
    if (!comicId) return [];
    const chaptersRes = await this.get(`/api/comics/${comicId}/chapters`, {
      headers: { Accept: 'application/json' },
    });
    const data = chaptersRes.data as WebtoonClubChapters;
    return (data.chapters ?? []).map(chapter => {
      const number = chapter.slug.replace(/^chapter-/, '');
      return {
        name: [`Chapter ${number}`, chapter.title].filter(Boolean).join(': '),
        url: `${mangaUrl.replace(/\/$/, '')}/chapter/${number}`,
        chapterNumber: Number.parseFloat(chapter.chapterNumber) || undefined,
        dateUpload: parseDate(chapter.date),
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const value = extractNextJsHtml(String(res.data), candidate => {
      if (!isJsonObject(candidate)) return false;
      return Array.isArray(candidate.images) && 'comicId' in candidate;
    });
    if (!isJsonObject(value) || !Array.isArray(value.images)) return [];
    const images = value.images as Json[];
    return images
      .filter((image): image is JsonObject => isJsonObject(image) && typeof image.filename === 'string')
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      .map((image, index) => ({
        index,
        imageUrl: `${this.baseUrl}/uploads/${String(image.filename)}`,
      }));
  }
}

export default WebtoonclubScraper;
