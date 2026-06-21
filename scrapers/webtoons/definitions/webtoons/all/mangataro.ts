import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import * as crypto from 'crypto';

interface SearchPayload {
  page: number;
  search: string;
  years: number[];
  genres: number[];
  types: string[];
  statuses: string[];
  sort: string;
  genreMatchMode: string;
}

interface BrowseMangaDto {
  id: string;
  url: string;
  title: string;
  cover: string;
  type: string;
  description: string;
  status: string;
}

interface ChapterDto {
  url: string;
  chapter: string;
  title?: string;
  date: string;
  group_name?: string;
  language: string;
}

interface ChapterListDto {
  chapters: ChapterDto[];
}

interface MangaDetailsDto {
  id: number;
  slug: string;
  title: { rendered: string };
  content: { rendered: string };
  type: string;
  _embedded: {
    'wp:featuredmedia'?: Array<{ source_url: string }>;
    'wp:term'?: Array<Array<{ name: string; taxonomy: string }>>;
  };
}

function unescapeHtml(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'",
    '&#8217;': "'",
    '&#8216;': "'",
    '&#8220;': '"',
    '&#8221;': '"',
    '&#8211;': '-',
    '&#8212;': '--',
    '&#8230;': '...',
  };
  let result = text;
  for (const [k, v] of Object.entries(entities)) {
    result = result.replace(new RegExp(k, 'g'), v);
  }
  return result.replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(parseInt(n)));
}

export class MangaTaroScraper extends BaseScraper {
  readonly name = 'MangaTaro';
  readonly baseUrl = 'https://mangataro.org';
  readonly lang = 'en';
  readonly supportsLatest = true;

  async getPopular(page: number = 1): Promise<SearchResult> {
    return this.search({ page, search: '', sort: 'popular_desc', genreMatchMode: 'any', years: [], genres: [], types: [], statuses: [] });
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    return this.search({ page, search: '', sort: 'post_desc', genreMatchMode: 'any', years: [], genres: [], types: [], statuses: [] });
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    return this.search({ page, search: query.trim(), sort: 'post_desc', genreMatchMode: 'any', years: [], genres: [], types: [], statuses: [] });
  }

  private async search(payload: SearchPayload): Promise<SearchResult> {
    const res = await this.post('/wp-json/manga/v1/load', payload, {
      headers: { 'Content-Type': 'application/json', Referer: `${this.baseUrl}/` },
    });
    const data = res.data as BrowseMangaDto[];
    const mangas: Manga[] = data.filter(m => m.type !== 'Novel' && m.url)
      .map(m => ({
        title: unescapeHtml(m.title),
        url: JSON.stringify({ id: m.id, slug: this.toSlug(m.url), group: null }),
        thumbnailUrl: m.cover,
        lang: this.lang,
        description: unescapeHtml(m.description),
      }));
    return { mangas, hasNextPage: data.length === 24 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const parsed = JSON.parse(mangaUrl);
    const res = await this.get(`/wp-json/wp/v2/manga/${parsed.id}?_embed`, {
      params: { _embed: null },
    });
    const data = res.data as MangaDetailsDto;
    const terms = (data._embedded?.['wp:term'] || []).find(t => t[0]?.taxonomy === 'post_tag') || [];
    const genre = terms.map(t => t.name).join(', ');
    const author = (data._embedded?.['wp:term'] || []).find(t => t[0]?.taxonomy === 'manga_author')?.map(t => t.name).join(', ');
    return {
      title: unescapeHtml(data.title.rendered),
      url: mangaUrl,
      thumbnailUrl: data._embedded?.['wp:featuredmedia']?.[0]?.source_url,
      lang: this.lang,
      author,
      description: unescapeHtml(data.content.rendered.replace(/<[^>]*>/g, '')),
      genre,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const parsed = JSON.parse(mangaUrl);
    const timestamp = Math.floor(Date.now() / 1000);
    const dateStr = new Date().toISOString().slice(0, 13).replace(/[-:]/g, '');
    const token = crypto.createHash('md5').update(`${timestamp}mng_ch_${dateStr}`).digest('hex').substring(0, 16);
    const params: Record<string, string> = {
      manga_id: parsed.id,
      offset: '0',
      limit: '9999',
      order: 'DESC',
      _t: token,
      _ts: timestamp.toString(),
    };
    if (parsed.group) params.group_id = parsed.group.toString();
    const res = await this.get('/auth/manga-chapters', { params });
    const data = res.data as ChapterListDto;
    const chapters: Chapter[] = data.chapters
      .filter(ch => ch.language.toLowerCase() === this.lang.toLowerCase())
      .map(ch => ({
        name: ch.title ? `Chapter ${ch.chapter}: ${unescapeHtml(ch.title)}` : `Chapter ${ch.chapter}`,
        url: ch.url,
        chapterNumber: parseFloat(ch.chapter),
        dateUpload: this.parseRelativeDate(ch.date),
        scanlator: ch.group_name || undefined,
      }));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('-').pop() || '';
    const res = await this.get('/auth/chapter-content', {
      params: { chapter_id: chapterId },
    });
    const data = res.data as { images: string[] };
    return data.images.map((url, idx) => ({ index: idx, imageUrl: url }));
  }

  private toSlug(url: string): string {
    try {
      const u = new URL(url);
      const path = u.pathname.split('/').filter(Boolean);
      if ((path.length === 2 && path[0] === 'manga') || (path.length === 3 && path[0] === 'read')) {
        return path[1];
      }
    } catch (err) {
      console.error(`Failed to parse URL for slug: ${err instanceof Error ? err.message : err}`);
    }
    return url;
  }

  private parseRelativeDate(date: string): number {
    const match = date.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
    if (!match) return 0;
    const num = parseInt(match[1]);
    const unit = match[2];
    const now = Date.now();
    const multipliers: Record<string, number> = {
      year: 365 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      hour: 60 * 60 * 1000,
      minute: 60 * 1000,
      second: 1000,
    };
    return now - num * (multipliers[unit] || 0);
  }
}
