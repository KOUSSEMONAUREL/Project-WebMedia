import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject, NextJsPredicate } from '../../../engine/nextjs';

interface BrowseSeries {
  sref: string;
  title: string;
  alternative_names?: string | null;
  thumbnail?: string | null;
  status?: string | null;
  update_chapter?: string | null;
  created_at?: string | null;
  total_views?: number | null;
}

interface SeriesChapter {
  chapter_name: string;
  chapter_title?: string | null;
  chapter_slug: string;
  lk?: number | null;
  created_at?: string | null;
}

interface SeriesDetails {
  sref: string;
  title: string;
  thumbnail?: string | null;
  author?: string | null;
  studio?: string | null;
  release_year?: string | null;
  alternative_names?: string | null;
  adult?: boolean | null;
  badge?: string | null;
  status?: string | null;
  description?: string | null;
  tag_series?: Array<{ tag: { name: string } }> | null;
  groups?: Array<{ items: SeriesChapter[] }> | null;
}

interface PagesList {
  images: string[];
}

function asRecord(value: Json): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function toBrowseSeries(value: Json): BrowseSeries | null {
  const o = asRecord(value);
  if (!o) return null;
  const sref = asString(o.sref);
  const title = asString(o.title);
  if (!sref || !title) return null;
  return {
    sref,
    title,
    alternative_names: asString(o.alternative_names ?? null),
    thumbnail: asString(o.thumbnail ?? null),
    status: asString(o.status ?? null),
    update_chapter: asString(o.update_chapter ?? null),
    created_at: asString(o.created_at ?? null),
    total_views: typeof o.total_views === 'number' ? o.total_views : null,
  };
}

const BROWSE_PREDICATE: NextJsPredicate = value =>
  Array.isArray(value) && value.length > 0 && toBrowseSeries(value[0]) !== null;

const DETAILS_PREDICATE: NextJsPredicate = value => {
  const o = asRecord(value);
  return o !== null && typeof o.sref === 'string' && Array.isArray(o.groups);
};

const PAGES_PREDICATE: NextJsPredicate = value => {
  const o = asRecord(value);
  return o !== null && Array.isArray(o.images) && (o.images as Json[]).every(i => typeof i === 'string');
};

const TEXT_TAGS_REGEX = /#(\w+)/gi;
const LAST_WORD_REGEX = /[\w\s]+:?\s*$/;

function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || parsed === 0 ? undefined : parsed;
}

export class TemplescanScraper extends BaseScraper {
  readonly name = 'Temple Scan';
  readonly baseUrl = 'https://templetoons.com';
  readonly lang = 'en';

  private async fetchRsc(url: string, predicate: NextJsPredicate): Promise<Json | null> {
    const res = await this.get(url, { headers: { rsc: '1' } });
    const ct = String(res.headers['content-type'] ?? '');
    const body = String(res.data);
    return ct.includes('text/html')
      ? extractNextJsHtml(body, predicate)
      : extractNextJsRsc(body, predicate);
  }

  private async fetchBrowse(): Promise<BrowseSeries[]> {
    const value = await this.fetchRsc(`${this.baseUrl}/comics`, BROWSE_PREDICATE);
    if (!Array.isArray(value)) return [];
    return value.map(toBrowseSeries).filter((s): s is BrowseSeries => s !== null);
  }

  private toManga(s: BrowseSeries): Manga {
    return {
      title: s.title,
      url: `/comic/${s.sref}`,
      thumbnailUrl: s.thumbnail ?? '',
      lang: this.lang,
    };
  }

  async getPopular(): Promise<SearchResult> {
    const series = await this.fetchBrowse();
    series.sort((a, b) => (b.total_views ?? 0) - (a.total_views ?? 0));
    return { mangas: series.map(s => this.toManga(s)), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    const series = await this.fetchBrowse();
    series.sort((a, b) => (parseDate(b.update_chapter) ?? 0) - (parseDate(a.update_chapter) ?? 0));
    return { mangas: series.map(s => this.toManga(s)), hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const series = await this.fetchBrowse();
    const q = query.trim().toLowerCase();
    const filtered = !q ? series : series.filter(s =>
      s.title.toLowerCase().includes(q) || (s.alternative_names ?? '').toLowerCase().includes(q),
    );
    return { mangas: filtered.map(s => this.toManga(s)), hasNextPage: false };
  }

  private async fetchDetails(mangaUrl: string): Promise<{ details: SeriesDetails; slug: string } | null> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    if (!slug) return null;
    const value = await this.fetchRsc(`${this.baseUrl}/comic/${slug}`, DETAILS_PREDICATE);
    const o = value !== null ? asRecord(value) : null;
    if (!o || typeof o.sref !== 'string' || typeof o.title !== 'string') return null;
    return { details: o as unknown as SeriesDetails, slug };
  }

  private cleanDescription(raw: string | null | undefined): string {
    if (!raw) return '';
    const clean = raw.includes('#')
      ? raw.substring(0, raw.indexOf('#')).replace(LAST_WORD_REGEX, '').trim()
      : raw;
    return clean.replace(/<[^>]*>/g, '').trim();
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const fetched = await this.fetchDetails(mangaUrl);
    if (!fetched) return { url: mangaUrl, lang: this.lang };
    const d = fetched.details;
    const status = d.status === 'Ongoing' ? 1
      : d.status === 'Completed' ? 0
      : d.status === 'Canceled' || d.status === 'Dropped' ? 2
      : undefined;
    const tags = (d.tag_series ?? []).map(t => t.tag?.name).filter((n): n is string => !!n);
    const hashTags = [...(d.description ?? '').matchAll(TEXT_TAGS_REGEX)].map(m => m[1]);
    const genre = [d.badge, d.release_year, d.adult ? 'Adult' : null, ...tags, ...hashTags]
      .filter((g): g is string => !!g)
      .join(', ') || undefined;
    let description = this.cleanDescription(d.description) || undefined;
    if (description && d.alternative_names?.trim()) {
      description = `${description}\n\nAlternative Name: ${d.alternative_names}`;
    }
    return {
      title: d.title,
      url: `/comic/${d.sref}`,
      thumbnailUrl: d.thumbnail ?? '',
      description,
      author: d.author ?? undefined,
      artist: d.studio ?? undefined,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const fetched = await this.fetchDetails(mangaUrl);
    if (!fetched) return [];
    const d = fetched.details;
    const chapters: Chapter[] = [];
    for (const group of d.groups ?? []) {
      for (const ch of group.items ?? []) {
        if ((ch.lk ?? 0) !== 0) continue;
        const name = ch.chapter_title?.trim()
          ? `${ch.chapter_name}: ${ch.chapter_title.trim()}`
          : ch.chapter_name;
        chapters.push({
          name,
          url: `/comic/${d.sref}/${ch.chapter_slug}`,
          dateUpload: parseDate(ch.created_at),
        });
      }
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const value = await this.fetchRsc(this.absUrl(chapterUrl), PAGES_PREDICATE);
    const o = value !== null ? asRecord(value) : null;
    if (!o || !Array.isArray(o.images)) return [];
    return (o.images as Json[])
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((url, index) => ({ index, imageUrl: url }));
  }
}
