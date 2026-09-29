import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject, NextJsPredicate } from '../../../engine/nextjs';

// Transcompilation of keiyoushi src/en/templescan (TempleScan.kt + Dto.kt).
// The site's RSC payload renames fields to deterministic short keys
// (title -> pnsk6q, slug -> s20a8oj, seasons -> u2ytwc, chapters -> qmy3ca,
// chapter_name -> u171tuh, chapter_slug -> y26ma5t, price -> u1e8nmi,
// images -> nu7315). Legacy long keys are kept as fallback.

interface BrowseSeries {
  slug: string;
  title: string;
  alternativeNames?: string | null;
  thumbnail?: string | null;
  badge?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  views?: number | null;
}

interface SeriesChapter {
  name: string;
  title?: string | null;
  slug: string;
  price: number;
  createdAt?: string | null;
}

interface ComicSeriesLd {
  name?: string | null;
  description?: string | null;
  image?: string | null;
  authorName?: string | null;
  alternateName?: string | null;
  genres: string[];
}

function asRecord(value: Json): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: Json | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function pickString(o: JsonObject, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = asString(o[k]);
    if (v !== null) return v;
  }
  return null;
}

function toBrowseSeries(value: Json): BrowseSeries | null {
  const o = asRecord(value);
  if (!o) return null;
  // New short keys first, legacy long keys as fallback.
  const title = pickString(o, 'pnsk6q', 'title');
  const slug = pickString(o, 's20a8oj', 'sref');
  if (!slug || !title) return null;
  const views = o.total_views;
  return {
    slug,
    title,
    alternativeNames: pickString(o, 'alternative_names'),
    thumbnail: pickString(o, 'thumbnail'),
    badge: pickString(o, 'badge'),
    status: pickString(o, 'status'),
    updatedAt: pickString(o, 'update_chapter'),
    createdAt: pickString(o, 'created_at'),
    views: typeof views === 'number' ? views : null,
  };
}

const BROWSE_PREDICATE: NextJsPredicate = value =>
  Array.isArray(value) && value.length > 0 && toBrowseSeries(value[0]) !== null;

function toSeriesChapter(value: Json): SeriesChapter | null {
  const o = asRecord(value);
  if (!o) return null;
  const name = pickString(o, 'u171tuh', 'chapter_name');
  const slug = pickString(o, 'y26ma5t', 'chapter_slug');
  if (!name || !slug) return null;
  const priceRaw = o.u1e8nmi ?? o.lk ?? o.price;
  const price = typeof priceRaw === 'number' ? priceRaw : 0;
  return {
    name,
    title: pickString(o, 'chapter_title'),
    slug,
    price,
    createdAt: pickString(o, 'created_at'),
  };
}

function extractChapters(value: Json): SeriesChapter[] {
  // New shape: { seriesData: { u2ytwc: [{ qmy3ca: [...] }] } }
  const root = asRecord(value);
  if (root) {
    const seriesData = asRecord(root.seriesData);
    const seasons = seriesData ? asRecordArray(seriesData.u2ytwc) : null;
    if (seasons) {
      const out: SeriesChapter[] = [];
      for (const season of seasons) {
        for (const item of asRecordArray(season.qmy3ca)) {
          const ch = toSeriesChapter(item);
          if (ch) out.push(ch);
        }
      }
      return out;
    }
    // Legacy shape: { sref, groups: [{ items: [...] }] }
    if (typeof root.sref === 'string' && Array.isArray(root.groups)) {
      const out: SeriesChapter[] = [];
      for (const group of asRecordArray(root.groups)) {
        for (const item of asRecordArray(group.items)) {
          const ch = toSeriesChapter(item);
          if (ch) out.push(ch);
        }
      }
      return out;
    }
  }
  return [];
}

function asRecordArray(value: Json | undefined): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is JsonObject => isJsonObject(v));
}

const DETAILS_PREDICATE: NextJsPredicate = value => {
  const o = asRecord(value);
  if (!o) return false;
  if (isJsonObject(o.seriesData)) return true;
  return typeof o.sref === 'string' && Array.isArray(o.groups);
};

const PAGES_PREDICATE: NextJsPredicate = value => {
  const o = asRecord(value);
  if (!o) return false;
  const images = o.nu7315 ?? o.images;
  return Array.isArray(images) && (images as Json[]).every(i => typeof i === 'string');
};

function parseComicSeriesLd(html: string): ComicSeriesLd | null {
  const scriptRe = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as Json;
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const o = asRecord(candidate);
        if (!o || o['@type'] !== 'ComicSeries') continue;
        const author = asRecord(o.author ?? null);
        const genres = asStringArray(o.genre);
        if (typeof o.genre === 'string') genres.push(o.genre);
        return {
          name: asString(o.name ?? undefined),
          description: asString(o.description ?? undefined),
          image: asString(o.image ?? undefined),
          authorName: author ? asString(author.name ?? undefined) : null,
          alternateName: asString(o.alternateName ?? undefined),
          genres,
        };
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return null;
}

// Upstream: selectFirst("#series-synopsis-text") puis union de tous les <p>
// qu'il contient. Si l'element est absent, upstream renvoie null: on ne
// doit surtout pas replier sur le document entier, ce qui remonterait le
// texte de navigation et de pied de page.
function parseSynopsis($: CheerioAPI): string | null {
  const section = $('#series-synopsis-text').first();
  if (section.length === 0) return null;
  const paragraphs = section
    .find('p')
    .toArray()
    .map(el => $(el).text().trim())
    .filter(Boolean);
  return paragraphs.length > 0 ? paragraphs.join('\n\n') : null;
}

function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || parsed === 0 ? undefined : parsed;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
};

export class TemplescanScraper extends BaseScraper {
  readonly name = 'Temple Scan';
  readonly baseUrl = 'https://templetoons.com';
  readonly lang = 'en';

  private async fetchRsc(url: string, predicate: NextJsPredicate): Promise<Json | null> {
    // Upstream no longer sends the `rsc: 1` header (the CDN now 403s it);
    // plain browser-fingerprinted GET + flight extraction instead.
    const res = await this.get(url, { headers: { ...BROWSER_HEADERS } });
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
      url: `/comic/${s.slug}`,
      thumbnailUrl: s.thumbnail ?? '',
      lang: this.lang,
    };
  }

  async getPopular(): Promise<SearchResult> {
    const series = await this.fetchBrowse();
    series.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    return { mangas: series.map(s => this.toManga(s)), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    const series = await this.fetchBrowse();
    series.sort((a, b) => (parseDate(b.updatedAt) ?? 0) - (parseDate(a.updatedAt) ?? 0));
    return { mangas: series.map(s => this.toManga(s)), hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const series = await this.fetchBrowse();
    const q = query.trim().toLowerCase();
    const filtered = !q ? series : series.filter(s =>
      s.title.toLowerCase().includes(q) || (s.alternativeNames ?? '').toLowerCase().includes(q),
    );
    return { mangas: filtered.map(s => this.toManga(s)), hasNextPage: false };
  }

  private slugFromUrl(mangaUrl: string): string {
    return mangaUrl.split('/').filter(Boolean).pop() ?? '';
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFromUrl(mangaUrl);
    if (!slug) return { url: mangaUrl, lang: this.lang };
    const res = await this.get(`${this.baseUrl}/comic/${slug}`, { headers: { ...BROWSER_HEADERS } });
    const html = String(res.data);
    const $ = this.$(html);
    const series = parseComicSeriesLd(html);
    // Status only lives in the browse catalog; the detail page has no stable hook.
    let catalogEntry: BrowseSeries | null = null;
    try {
      const catalog = await this.fetchBrowse();
      catalogEntry = catalog.find(s => s.slug === slug) ?? null;
    } catch {
      catalogEntry = null;
    }

    const genres = series?.genres ?? [];
    const adult = genres.some(g => g.toLowerCase() === '+18');
    const status = (catalogEntry?.status ?? '').toLowerCase();
    const synopsis = parseSynopsis($) ?? series?.description ?? '';
    const descriptionParts: string[] = [];
    if (synopsis.trim()) descriptionParts.push(synopsis.trim());
    const altName = series?.alternateName?.trim();
    if (altName) descriptionParts.push(`Alternative Name: ${altName}`);
    const genre = [
      catalogEntry?.badge ?? null,
      adult ? 'Adult' : null,
      ...genres.filter(g => g.toLowerCase() !== '+18'),
    ].filter((g): g is string => !!g).join(', ') || undefined;

    return {
      title: series?.name ?? catalogEntry?.title ?? slug,
      url: `/comic/${slug}`,
      thumbnailUrl: series?.image ?? catalogEntry?.thumbnail ?? '',
      description: descriptionParts.join('\n\n') || undefined,
      author: series?.authorName ?? undefined,
      genre,
      status: status === 'ongoing' ? 1
        : status === 'completed' ? 0
        : status === 'canceled' || status === 'dropped' ? 2
        : status === 'hiatus' ? 3
        : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    if (!slug) return [];
    const value = await this.fetchRsc(`${this.baseUrl}/comic/${slug}`, DETAILS_PREDICATE);
    if (value === null) return [];
    // Upstream default hides locked (paid early-access) chapters.
    return extractChapters(value)
      .filter(ch => ch.price <= 0)
      .map(ch => ({
        name: ch.title?.trim() ? `${ch.name}: ${ch.title.trim()}` : ch.name,
        url: `/comic/${slug}/${ch.slug}`,
        dateUpload: parseDate(ch.createdAt),
      }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const value = await this.fetchRsc(this.absUrl(chapterUrl), PAGES_PREDICATE);
    const o = value !== null ? asRecord(value) : null;
    const raw = o ? (o.nu7315 ?? o.images) : null;
    if (!Array.isArray(raw)) return [];
    return (raw as Json[])
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((url, index) => ({ index, imageUrl: url }));
  }
}
