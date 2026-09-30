import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject, NextJsPredicate } from '../../../engine/nextjs';

// Transcompilation of keiyoushi src/en/templescan (TempleScan.kt + Dto.kt +
// RscKeys.kt). The site's RSC payload renames fields to deterministic short
// keys derived from a rotating salt (FNV-1a 32-bit of "<salt>:<name>:<i>").
// Committed key literals go stale on every salt rotation, so this scraper
// derives the keys at runtime (RscKeys port below), remaps payloads to
// logical names before decoding, and re-reads the salt from the site's
// `_next/static/chunks/` bundle when the payload stops matching.

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

// ------------------------------------------------------------
// RscKeys port (upstream RscKeys.kt): the site derives its short
// field keys from a salt found in its own client bundle.
// ------------------------------------------------------------

const RSC_FIELDS = [
  'series_slug',
  'Season',
  'Chapter',
  'price',
  'title',
  'chapter_name',
  'chapter_slug',
  'images',
] as const;

type RscField = (typeof RSC_FIELDS)[number];

const RSC_DEFAULT_SALT = 'd5c68d61d4c2';
const RSC_CHUNK_PATH = '/_next/static/chunks/';
const RSC_FIELD_LIST_LITERAL = RSC_FIELDS.map(f => `"${f}"`).join(',');
const RSC_SALT_REGEX = /["']([0-9a-f]{8,32})["']\s*,\s*["']:["']/;

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5 | 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function encodeRscKey(hash: number): string {
  const unsigned = hash >>> 0;
  return `${String.fromCharCode(97 + (unsigned % 26))}${(unsigned >>> 5).toString(36)}`;
}

function deriveRscKeys(salt: string): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const field of RSC_FIELDS) {
    let collision = 0;
    let key = '';
    do {
      key = encodeRscKey(fnv1a32(`${salt}:${field}:${collision}`));
      collision++;
    } while (used.has(key));
    used.add(key);
    out.set(field, key);
  }
  return out;
}

function remapRscKeys(value: Json, keys: Map<string, string>): Json {
  const byShortKey = new Map<string, string>();
  for (const [field, key] of keys) byShortKey.set(key, field);
  const rewrite = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (isJsonObject(node)) {
      const out: JsonObject = {};
      for (const k of Object.keys(node)) {
        out[byShortKey.get(k) ?? k] = rewrite(node[k]);
      }
      return out;
    }
    return node;
  };
  return rewrite(value);
}

function rscPayloadPredicate(fields: RscField[], keys: Map<string, string>, isList: boolean): NextJsPredicate {
  const required = new Set(fields.map(f => keys.get(f) ?? f));
  if (isList) {
    return (value: Json) => {
      if (!Array.isArray(value) || value.length === 0) return false;
      const first = value[0];
      if (!isJsonObject(first)) return false;
      return [...required].every(k => k in first);
    };
  }
  return (value: Json) => {
    if (!isJsonObject(value)) return false;
    return [...required].every(k => k in value);
  };
}

function findRscSalt(chunkSource: string): string | null {
  const fieldsAt = chunkSource.indexOf(RSC_FIELD_LIST_LITERAL);
  if (fieldsAt === -1) return null;
  const match = RSC_SALT_REGEX.exec(chunkSource.slice(fieldsAt));
  return match?.[1] ?? null;
}

const CATALOG_FIELDS: RscField[] = ['title', 'series_slug'];
const SERIES_FIELDS: RscField[] = ['series_slug', 'Season'];
const PAGES_FIELDS: RscField[] = ['images'];

function toBrowseSeries(value: Json): BrowseSeries | null {
  const o = asRecord(value);
  if (!o) return null;
  // Logical names (post-remap) first; previous-salt short keys as fallback.
  const title = pickString(o, 'title', 'pnsk6q');
  const slug = pickString(o, 'series_slug', 's20a8oj', 'sref');
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
  const name = pickString(o, 'chapter_name', 'u171tuh');
  const slug = pickString(o, 'chapter_slug', 'y26ma5t');
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

function chaptersFromSeasons(seasons: JsonObject[]): SeriesChapter[] {
  const out: SeriesChapter[] = [];
  for (const season of seasons) {
    for (const item of asRecordArray(season.Chapter ?? season.qmy3ca)) {
      const ch = toSeriesChapter(item);
      if (ch) out.push(ch);
    }
  }
  return out;
}

function extractChapters(value: Json): SeriesChapter[] {
  // Current shape (post-remap): the matched node IS the SeriesData object
  // itself, i.e. { series_slug, Season: [{ Chapter: [...] }] } — there is no
  // `seriesData` wrapper (upstream Dto.kt: `class SeriesData(Season)`).
  const root = asRecord(value);
  if (root) {
    const flat = chaptersFromSeasons(asRecordArray(root.Season ?? root.u2ytwc));
    if (flat.length > 0) return flat;
    const seriesData = asRecord(root.seriesData);
    if (seriesData) {
      const wrapped = chaptersFromSeasons(asRecordArray(seriesData.Season ?? seriesData.u2ytwc));
      if (wrapped.length > 0) return wrapped;
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

  private rscSalt: string | null = null;

  private rscKeys(): Map<string, string> {
    return deriveRscKeys(this.rscSalt ?? RSC_DEFAULT_SALT);
  }

  // Upstream TempleScan.mappedPayload: extract the RSC node holding `fields`
  // with the current salt's keys, remap short keys to logical names, and —
  // when nothing matches — re-read the salt from the client bundle once.
  private async fetchMapped(url: string, fields: RscField[], isList: boolean): Promise<Json | null> {
    // Upstream no longer sends the `rsc: 1` header (the CDN now 403s it);
    // plain browser-fingerprinted GET + flight extraction instead.
    const res = await this.get(url, { headers: { ...BROWSER_HEADERS } });
    const ct = String(res.headers['content-type'] ?? '');
    const body = String(res.data);
    const isHtml = ct.includes('text/html');
    const extract = (predicate: NextJsPredicate): Json | null =>
      isHtml ? extractNextJsHtml(body, predicate) : extractNextJsRsc(body, predicate);

    const keys = this.rscKeys();
    const direct = extract(rscPayloadPredicate(fields, keys, isList));
    if (direct !== null) return remapRscKeys(direct, keys);

    // Legacy-shape fallback (previous-salt short keys / legacy layout).
    const legacyPredicate = isList
      ? BROWSE_PREDICATE
      : fields === PAGES_FIELDS ? PAGES_PREDICATE : DETAILS_PREDICATE;
    const legacy = extract(legacyPredicate);
    if (legacy !== null) return legacy;

    if (isHtml) {
      const refreshed = await this.refreshRscSalt(body);
      if (refreshed !== null) {
        const retry = extract(rscPayloadPredicate(fields, refreshed, isList));
        if (retry !== null) return remapRscKeys(retry, refreshed);
      }
    }
    return null;
  }

  // Re-reads the field-key salt from the site's client bundle (module 14834
  // chunk) and caches it for later runs.
  private async refreshRscSalt(html: string): Promise<Map<string, string> | null> {
    const $ = this.$(html);
    const sources = $('script[src]')
      .toArray()
      .map(el => $(el).attr('src') ?? '')
      .filter(src => src.includes(RSC_CHUNK_PATH))
      .map(src => {
        try {
          return new URL(src, this.baseUrl).toString();
        } catch {
          return '';
        }
      })
      .filter(src => src.length > 0);
    for (const src of [...new Set(sources)]) {
      try {
        const res = await this.get(src, { headers: { ...BROWSER_HEADERS } });
        const salt = findRscSalt(String(res.data));
        if (salt) {
          this.rscSalt = salt;
          return deriveRscKeys(salt);
        }
      } catch {
        // Try the next chunk.
      }
    }
    return null;
  }

  private async fetchBrowse(): Promise<BrowseSeries[]> {
    const value = await this.fetchMapped(`${this.baseUrl}/comics`, CATALOG_FIELDS, true);
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
    const value = await this.fetchMapped(`${this.baseUrl}/comic/${slug}`, SERIES_FIELDS, false);
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
    const value = await this.fetchMapped(this.absUrl(chapterUrl), PAGES_FIELDS, false);
    const o = value !== null ? asRecord(value) : null;
    const raw = o ? (o.images ?? o.nu7315) : null;
    if (!Array.isArray(raw)) return [];
    return (raw as Json[])
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((url, index) => ({ index, imageUrl: url }));
  }
}
