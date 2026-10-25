import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const CATEGORY_EN = 5;
const CATEGORY_ES = 6;
const PER_PAGE = 100;
/**
 * Upstream syncs and caches the whole WP archive (~4.8k posts). This port has
 * no persistent cache and CI enforces a 10s probe, so it indexes the 500 most
 * recent posts (5 requests) instead. Old, finished series are consequently
 * absent from search/popular; bump this if the pipeline ever grows a cache.
 */
const MAX_LIST_PAGES = 5;

interface WpRendered {
  rendered: string;
}

interface WpPost {
  id: number;
  slug: string;
  title: WpRendered;
  date_gmt: string;
  categories: number[];
  content: WpRendered;
}

interface CachedPost {
  id: number;
  slug: string;
  lang: 'en' | 'es';
  key: string;
  title: string;
  number: string;
  part?: string;
  date?: number;
  cover?: string;
  hasPages: boolean;
}

interface Series {
  key: string;
  title: string;
  cover?: string;
  posts: CachedPost[];
  chapters: CachedPost[];
}

function toKey(value: string): string {
  return value.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parsePost(post: WpPost, $: CheerioAPI): CachedPost | null {
  const rawTitle = decodeEntities(post.title.rendered).trim();
  const lower = rawTitle.toLowerCase();
  let lang: 'en' | 'es';
  if (lower.includes('español')) lang = 'es';
  else if (lower.includes('english')) lang = 'en';
  else if (post.categories.includes(CATEGORY_EN)) lang = 'en';
  else if (post.categories.includes(CATEGORY_ES)) lang = 'es';
  else return null;

  const prefix = rawTitle.split('【')[0].trim();
  const bracket = rawTitle.includes('【') ? rawTitle.split('【')[1].split('】')[0] : '';
  let number: string;
  let name: string;
  const bracketNumber = /\d+(?:\.\d+)?/.exec(bracket);
  if (bracketNumber) {
    number = bracketNumber[0];
    name = prefix.endsWith(` ${number}`) ? prefix.slice(0, -number.length - 1) : prefix;
  } else {
    const trailing = /\s+(?:chapter\s+)?(\d+(?:\.\d+)?)(?:\s+(?:english|español))?$/i.exec(prefix);
    if (!trailing) return null;
    number = trailing[1];
    name = prefix.slice(0, trailing.index);
  }
  name = name.replace(/(?:\s+(?:chapter|english|español))+$/i, '').trim();
  if (!name) return null;

  const cover = $('img.alignleft').first().attr('src')
    ?? $('img').filter((_i, el) => !$(el).hasClass('alignleft')).first().attr('src');
  const part = /parte?\s*(\d+)/i.exec(bracket)?.[1];
  const hasPages = $('img').filter((_i, el) => !$(el).hasClass('alignleft')).length > 0;
  const date = post.date_gmt ? Date.parse(`${post.date_gmt}Z`) : NaN;

  return {
    id: post.id,
    slug: post.slug,
    lang,
    key: toKey(name),
    title: name,
    number,
    part,
    date: Number.isNaN(date) ? undefined : date,
    cover,
    hasPages,
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, digits: string) => String.fromCharCode(Number.parseInt(digits, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, digits: string) => String.fromCharCode(Number.parseInt(digits, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function chapterValue(post: CachedPost): number {
  const number = Number.parseFloat(post.number);
  if (!Number.isFinite(number)) return 0;
  const part = post.part ? Number.parseFloat(post.part) : undefined;
  return number + (part && part > 0 ? (part - 1) / part : 0);
}

export class MangaomegaScraper extends BaseScraper {
  readonly name = 'Manga Omega';
  readonly baseUrl = 'https://mangaomega.com';
  readonly lang = 'all';

  private parsePosts(posts: WpPost[]): Series[] {
    const parsed = posts
      .map(post => parsePost(post, this.$(post.content.rendered)))
      .filter((post): post is CachedPost => post !== null);
    const groups = new Map<string, CachedPost[]>();
    for (const post of parsed) {
      const list = groups.get(post.key) ?? [];
      list.push(post);
      groups.set(post.key, list);
    }
    const series: Series[] = [];
    for (const [key, group] of groups) {
      const chapters = group.filter(post => post.hasPages);
      if (chapters.length === 0) continue;
      chapters.sort((a, b) => chapterValue(b) - chapterValue(a) || (b.date ?? 0) - (a.date ?? 0));
      const posts = group.slice().sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
      series.push({
        key,
        title: posts[0].title,
        cover: posts.find(post => post.cover)?.cover,
        posts,
        chapters,
      });
    }
    return series;
  }

  private async fetchPosts(params: Record<string, string>): Promise<WpPost[]> {
    const query = new URLSearchParams({
      per_page: String(PER_PAGE),
      page: '1',
      orderby: 'date',
      order: 'desc',
      _fields: 'id,slug,title,date_gmt,categories,content',
      ...params,
    });
    const out: WpPost[] = [];
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      query.set('page', String(page));
      const res = await this.get(`/wp-json/wp/v2/posts?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const batch = res.data as WpPost[];
      out.push(...batch);
      const totalPages = Number.parseInt(String(res.headers['x-wp-totalpages'] ?? '0'), 10);
      if (!Number.isFinite(totalPages) || page >= totalPages || batch.length < PER_PAGE) break;
    }
    return out;
  }

  private toManga(series: Series): Manga {
    return {
      title: series.title,
      url: `/?s=${encodeURIComponent(series.title)}`,
      thumbnailUrl: series.cover ?? '',
      lang: this.lang,
    };
  }

  async getPopular(): Promise<SearchResult> {
    const series = this.parsePosts(await this.fetchPosts({}))
      .sort((a, b) => b.chapters.length - a.chapters.length);
    return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    const series = this.parsePosts(await this.fetchPosts({}))
      .sort((a, b) => (b.chapters[0]?.date ?? 0) - (a.chapters[0]?.date ?? 0));
    return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      const series = this.parsePosts(await this.fetchPosts({}))
        .sort((a, b) => b.chapters.length - a.chapters.length);
      return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
    }
    const series = this.parsePosts(await this.fetchPosts({ search: trimmed }))
      .filter(item => item.key.includes(toKey(trimmed)))
      .slice((page - 1) * PER_PAGE, page * PER_PAGE);
    return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
  }

  private seriesFromUrl(mangaUrl: string): string {
    try {
      return new URL(mangaUrl, this.baseUrl).searchParams.get('s') ?? '';
    } catch {
      return '';
    }
  }

  private async findSeries(mangaUrl: string): Promise<Series | null> {
    const title = this.seriesFromUrl(mangaUrl);
    if (!title) return null;
    const key = toKey(title);
    const series = this.parsePosts(await this.fetchPosts({ search: title }));
    return series.find(item => item.key === key) ?? series[0] ?? null;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const series = await this.findSeries(mangaUrl);
    if (!series) return { url: mangaUrl, lang: this.lang };
    return { ...this.toManga(series), url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const series = await this.findSeries(mangaUrl);
    if (!series) return [];
    return series.chapters.map(post => {
      const number = chapterValue(post);
      return {
        name: post.part ? `Chapter ${post.number} Part ${post.part}` : `Chapter ${post.number}`,
        url: `/?p=${post.id}`,
        chapterNumber: number,
        dateUpload: post.date,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    let id = '';
    try {
      id = new URL(chapterUrl, this.baseUrl).searchParams.get('p') ?? '';
    } catch {
      id = '';
    }
    if (!id) return [];
    const res = await this.get(`/wp-json/wp/v2/posts/${encodeURIComponent(id)}?_fields=content`, {
      headers: { Accept: 'application/json' },
    });
    const content = (res.data as { content?: WpRendered }).content?.rendered ?? '';
    const $ = this.$(content);
    return $('img').filter((_i, el) => !$(el).hasClass('alignleft')).toArray()
      .map(el => $(el).attr('src') ?? '')
      .filter(Boolean)
      .map((imageUrl, index) => ({ index, imageUrl: this.absUrl(imageUrl) }));
  }
}

export default MangaomegaScraper;
