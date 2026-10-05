import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';
import { extractNextJsHtml, extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject, NextJsPredicate } from '../../../engine/nextjs';

// Transcompilation of keiyoushi src/en/templescan (TempleScan.kt + Dto.kt +
// RscKeys.kt). The site's RSC payload renames fields to short keys shipped
// in its own client bundle (module `14834`) as a positional pair of lists.
// Committed key literals go stale on every rebuild, so this scraper reads
// the table at runtime (RscKeys port below), remaps payloads to logical
// names before decoding, and re-reads the table from the site's
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
// RscKeys port (upstream RscKeys.kt, module `14834`): the site ships its
// short field-key table in its own client bundle. Current bundle format
// (upstream #404): a positional list of logical names, then a salt string
// that each name slices a key out of, e.g.
//   ["Chapter","images",...],a="o682...fk"; l=1+a.charCodeAt(0)%15;
//   key(names[t])=salt.slice(((t+l)%16)*7,+7).
// Slot count, key length and rotation offset are all read from the bundle,
// so a rebuild that rotates the salt no longer needs an extension update.
// The previous comma-separated format (`.split(",")`) is kept as fallback.
// ------------------------------------------------------------

type RscField = string;

const RSC_CHUNK_PATH = '/_next/static/chunks/';
const RSC_TABLE_REGEX = /\[((?:"[A-Za-z0-9_]+",?)+)\],\s*([A-Za-z0-9_$]{1,40})\s*=\s*"([A-Za-z0-9]+)"/g;
const RSC_OFFSET_REGEX = /([A-Za-z0-9_$]{1,40})\s*=\s*(\d+)\s*\+\s*([A-Za-z0-9_$]{1,40})\.charCodeAt\(0\)\s*%\s*(\d+)/g;
const RSC_SLOT_REGEX = /\(\s*[A-Za-z0-9_$]{1,40}\s*\+\s*([A-Za-z0-9_$]{1,40})\s*\)\s*%\s*(\d+)\s*\*\s*(\d+)/g;
const RSC_SPLIT_REGEX = /\[((?:"[A-Za-z0-9_]+",?)+)\],\s*[^=;]{1,32}=\s*"([^"]*)"\.split\(",\)/;
const RSC_NAME_REGEX = /"([A-Za-z0-9_]+)"/g;
// How far past the names array the minified derivation may sit before it is
// not the one (upstream DERIVATION_WINDOW).
const RSC_DERIVATION_WINDOW = 600;

function rscNames(raw: string): string[] {
  const names: string[] = [];
  const nameRe = new RegExp(RSC_NAME_REGEX);
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(raw)) !== null) names.push(m[1]);
  return names;
}

// Salt-based derivation (module 14834): names[i] slices `keyLength` chars
// out of the salt at slot `(i + start) % slotCount`.
function deriveSaltKeys(names: string[], salt: string, saltVar: string, derivation: string): Map<string, string> | null {
  const offsetRe = new RegExp(RSC_OFFSET_REGEX);
  let offset: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = offsetRe.exec(derivation)) !== null) {
    if (m[3] === saltVar) {
      offset = m;
      break;
    }
  }
  if (!offset) return null;
  const slotRe = new RegExp(RSC_SLOT_REGEX);
  let slot: RegExpExecArray | null = null;
  while ((m = slotRe.exec(derivation)) !== null) {
    if (m[1] === offset[1]) {
      slot = m;
      break;
    }
  }
  if (!slot) return null;
  const slotCount = Number.parseInt(slot[2], 10);
  const keyLength = Number.parseInt(slot[3], 10);
  if (!slotCount || !keyLength) return null;
  // The bundle's own guard: the salt must divide evenly into its slots and
  // name every field.
  if (salt.length !== slotCount * keyLength || names.length > slotCount) return null;
  const start = Number.parseInt(offset[2], 10) + (salt.charCodeAt(0) % Number.parseInt(offset[4], 10));
  const out = new Map<string, string>();
  names.forEach((name, index) => {
    const position = (((index + start) % slotCount) * keyLength);
    out.set(name, salt.substring(position, position + keyLength));
  });
  return out;
}

function findRscTable(chunkSource: string): Map<string, string> | null {
  const tableRe = new RegExp(RSC_TABLE_REGEX);
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(chunkSource)) !== null) {
    const names = rscNames(m[1]);
    const saltVar = m[2];
    const salt = m[3];
    const derivation = chunkSource.substring(m[0].length + (m.index ?? 0), (m.index ?? 0) + m[0].length + RSC_DERIVATION_WINDOW);
    const table = deriveSaltKeys(names, salt, saltVar, derivation);
    if (table && table.size > 0) return table;
  }
  const split = RSC_SPLIT_REGEX.exec(chunkSource);
  if (split) {
    const names = rscNames(split[1]);
    const keys = split[2].split(',');
    // The bundle itself throws when it cannot name every field; treat that as "not this chunk".
    if (keys.length >= names.length && names.length > 0) {
      const out = new Map<string, string>();
      names.forEach((n, i) => out.set(n, keys[i]));
      return out;
    }
  }
  return null;
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

  private rscTable: Map<string, string> | null = null;

  private cachedRscKeys(): Map<string, string> | null {
    return this.rscTable && this.rscTable.size > 0 ? this.rscTable : null;
  }

  // Upstream TempleScan.mappedPayload: extract the RSC node holding `fields`
  // with the current table's keys, remap short keys to logical names, and —
  // when nothing matches — re-read the table from the client bundle once.
  private async fetchMapped(url: string, fields: RscField[], isList: boolean): Promise<Json | null> {
    // Upstream no longer sends the `rsc: 1` header (the CDN now 403s it);
    // plain browser-fingerprinted GET + flight extraction instead.
    const res = await this.get(url, { headers: { ...BROWSER_HEADERS } });
    const ct = String(res.headers['content-type'] ?? '');
    const body = String(res.data);
    const isHtml = ct.includes('text/html');
    const extract = (predicate: NextJsPredicate): Json | null =>
      isHtml ? extractNextJsHtml(body, predicate) : extractNextJsRsc(body, predicate);

    const keys = this.cachedRscKeys() ?? await this.refreshRscKeys(body);
    if (keys) {
      const direct = extract(rscPayloadPredicate(fields, keys, isList));
      if (direct !== null) return remapRscKeys(direct, keys);
    }

    // Legacy-shape fallback (previous short keys / legacy layout).
    const legacyPredicate = isList
      ? BROWSE_PREDICATE
      : fields === PAGES_FIELDS ? PAGES_PREDICATE : DETAILS_PREDICATE;
    const legacy = extract(legacyPredicate);
    if (legacy !== null) return legacy;

    if (isHtml) {
      const refreshed = await this.refreshRscKeys(body);
      if (refreshed !== null) {
        const retry = extract(rscPayloadPredicate(fields, refreshed, isList));
        if (retry !== null) return remapRscKeys(retry, refreshed);
      }
    }
    return null;
  }

  // Re-reads the field rename table from the site's client bundle (module 14834
  // chunk) and caches it for later runs.
  private async refreshRscKeys(html: string): Promise<Map<string, string> | null> {
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
        const table = findRscTable(String(res.data));
        if (table && table.size > 0) {
          this.rscTable = table;
          return table;
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
