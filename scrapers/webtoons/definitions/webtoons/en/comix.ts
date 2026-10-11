import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/comix` (Comix.kt + Dto.kt), catalogue and
 * series page only.
 *
 * The site is a client-rendered app whose catalogue lives in
 * `<script type="application/json" id="initial-data">` (`queries` map):
 * - Popular: home `/` query `["manga","top",{type:trending,…}]` (50 entries).
 * - Latest: home `/` query `["manga","list",{scope:hot,order:{chapter_updated_at}}]`
 *   (31 entries, `meta.hasNext`).
 * - Details: `/title/<slug>` query `["manga","detail","<hid>"]`.
 *
 * Item shape (`Dto.Manga`): `hid`, `title`, `url` (`/title/<hid>-<slug>`),
 * `poster.{small,medium,large}`, `synopsis`, `status`, `authors`/`artists`,
 * `genres`/`demographics`, `contentRating`, `year`, `originalLanguage`.
 *
 * Deliberate divergences from the Kt (all reader-side, all requiring a
 * browser or the signed API — hence out of scope for the webtoon pipeline,
 * which only ingests the series URL):
 * - `/browse` renders a 7 ko shell over plain HTTP and its JSON comes from
 *   the signed `/api/v1/manga` (`403 Missing token` unsigned), so browse and
 *   server-side search are unreachable without the Kt's WebView cipher. Search
 *   therefore filters the home catalogue locally.
 * - The chapter list needs the same signed API (`getNativeChapterList`) or a
 *   WebView (`getWebViewChapterList`); `getChapterList` returns `[]` and
 *   `getPageList` returns `[]` (`comic-unsupported`, not `webtoon-unsupported`).
 * - The `?v3`/`#scrambled` image descriptors and alt-host retry concern only
 *   page images, which are never ingested here.
 *
 * Verified live 2026-10-11 (`curl -4`): `/` 200 with 8 queries (trending 50,
 * hot 31/719, `url` present on every item), `/browse` 200 but 0 queries,
 * `/api/v1/manga` 403 `Missing token`, `/title/<slug>` 200 with a `detail`
 * query (title, synopsis, poster on `static.comix.to`).
 */

interface ComixPoster {
  small?: string;
  medium?: string;
  large?: string;
}

interface ComixTerm {
  title: string;
}

interface ComixItem {
  hid: string;
  title: string;
  url?: string;
  synopsis?: string | null;
  type?: string;
  status?: string;
  originalLanguage?: string | null;
  year?: number | null;
  contentRating?: string;
  poster?: ComixPoster | null;
  authors?: ComixTerm[] | null;
  artists?: ComixTerm[] | null;
  genres?: ComixTerm[] | null;
  demographics?: ComixTerm[] | null;
  rank?: number;
}

interface ComixQueries {
  page?: string;
  queries: Record<string, unknown>;
}

function extractInitialData(html: string): ComixQueries {
  const match = /<script type="application\/json" id="initial-data">(.*?)<\/script>/s.exec(html);
  if (!match) throw new Error('Could not find initial data in page');
  return JSON.parse(match[1]) as ComixQueries;
}

function posterUrl(poster: ComixPoster | null | undefined): string {
  if (!poster) return '';
  return poster.medium ?? poster.large ?? poster.small ?? '';
}

export class ComixScraper extends BaseScraper {
  readonly name = 'Comix';
  readonly baseUrl = 'https://comix.to';
  readonly lang = 'en';

  private toManga(item: ComixItem): Manga {
    return {
      title: item.title,
      url: item.url ?? `/${item.hid}`,
      thumbnailUrl: posterUrl(item.poster),
      lang: this.lang,
    };
  }

  private mangaItems(value: unknown): ComixItem[] {
    if (Array.isArray(value)) return value as ComixItem[];
    if (value !== null && typeof value === 'object') {
      const items = (value as { items?: unknown }).items;
      if (Array.isArray(items)) return items as ComixItem[];
    }
    return [];
  }

  private async fetchHome(): Promise<Record<string, unknown>> {
    const res = await this.get('/');
    return extractInitialData(res.data as string).queries;
  }

  async getPopular(): Promise<SearchResult> {
    const queries = await this.fetchHome();
    const key = Object.keys(queries).find((k) => k.includes('"trending"')) ?? '';
    const items = key ? this.mangaItems(queries[key]) : [];
    return { mangas: items.map((item) => this.toManga(item)), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    const queries = await this.fetchHome();
    const key = Object.keys(queries).find((k) => k.includes('"scope":"hot"')) ?? '';
    const items = key ? this.mangaItems(queries[key]) : [];
    return { mangas: items.map((item) => this.toManga(item)), hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    // No server-side search over plain HTTP (`/browse` hydrates through the
    // signed API): filter the home catalogue locally instead.
    const queries = await this.fetchHome();
    const seen = new Map<string, ComixItem>();
    for (const value of Object.values(queries)) {
      for (const item of this.mangaItems(value)) {
        if (item.hid && !seen.has(item.hid)) seen.set(item.hid, item);
      }
    }
    const needle = query.trim().toLowerCase();
    const all = [...seen.values()];
    const mangas = needle ? all.filter((item) => item.title.toLowerCase().includes(needle)) : all;
    return { mangas: mangas.map((item) => this.toManga(item)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const queries = extractInitialData(res.data as string).queries;
    const key = Object.keys(queries).find((k) => k.includes('"detail"')) ?? '';
    if (!key) throw new Error('Could not find manga detail in queries');
    const detail = queries[key] as ComixItem;
    const genres: string[] = [];
    if (detail.type === 'manhwa') genres.push('Manhwa');
    else if (detail.type === 'manhua') genres.push('Manhua');
    else if (detail.type === 'manga') genres.push('Manga');
    for (const group of [detail.genres, detail.demographics]) {
      for (const term of group ?? []) genres.push(term.title);
    }
    if (detail.contentRating === 'erotica' || detail.contentRating === 'pornographic') genres.push('NSFW');
    const status = detail.status ?? '';
    return {
      title: detail.title,
      url: mangaUrl,
      thumbnailUrl: posterUrl(detail.poster),
      description: detail.synopsis ?? undefined,
      author: detail.authors?.map((a) => a.title).join(', ') || undefined,
      artist: detail.artists?.map((a) => a.title).join(', ') || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      status: status === 'releasing' ? 1
        : status === 'on_hiatus' ? 3
        : status === 'finished' ? 0
        : status === 'discontinued' ? 2
        : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    // Chapter list requires the signed native API or a WebView (Kt:
    // `getNativeChapterList` / `getWebViewChapterList`); unreachable over
    // plain HTTP. The webtoon pipeline only ingests the series URL.
    return [];
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    // Page images are signed/scrambled (`?v3`, alt hosts) and never ingested
    // on the webtoon path.
    return [];
  }
}

export default ComixScraper;
