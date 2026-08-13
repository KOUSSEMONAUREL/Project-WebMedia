import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const BASE_URL = 'https://duskscans.com';

interface MangaDto {
  id: string;
  title: string;
  slug: string;
  alternativeTitle?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  cover?: string | null;
  status?: string | null;
  type?: string | null;
  views: number;
  rating: number;
  genres: string[];
  createdAt?: string | null;
}

interface ChapterDto {
  id: string;
  number: number;
  title: string;
  releaseDate?: string | null;
}

interface SeriesPageDto {
  initialManga: MangaDto;
  initialChapters: ChapterDto[];
}

interface ChapterDetailDto {
  pages: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function matchesQuery(manga: MangaDto, query: string): boolean {
  return (
    manga.title.toLowerCase().includes(query) ||
    (manga.alternativeTitle ?? '').toLowerCase().includes(query)
  );
}

function parseChapterDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

function resolveValue(value: JsonValue, chunkCache: Map<string, string>): JsonValue {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('$')) return value;
  const str = value;
  if (str === '$undefined') return null;
  if (str[1] === '$') return str.substring(1);
  if (str[1] === 'D') return str.substring(2);
  const ref = str.substring(1);
  const id = ref.split(':')[0];
  const chunk = chunkCache.get(id);
  if (chunk !== undefined) return chunk;
  return value;
}

function parseRscPayload(body: string): JsonValue[] {
  const results: JsonValue[] = [];
  const chunkCache = new Map<string, string>();
  let pos = 0;
  while (pos < body.length) {
    const colonIdx = body.indexOf(':', pos);
    if (colonIdx === -1) break;
    const id = body.substring(pos, colonIdx);
    if (id.length === 0 || !/^[0-9a-fA-F]+$/.test(id)) {
      pos++;
      continue;
    }
    pos = colonIdx + 1;
    if (pos >= body.length) break;
    if (body[pos] === 'T') {
      pos++;
      const commaIdx = body.indexOf(',', pos);
      if (commaIdx === -1) break;
      const byteLen = parseInt(body.substring(pos, commaIdx), 16);
      if (isNaN(byteLen)) break;
      pos = commaIdx + 1;
      let bytes = 0;
      const start = pos;
      while (pos < body.length && bytes < byteLen) {
        const code = body.charCodeAt(pos);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
          bytes += 4;
          pos++;
        } else bytes += 3;
        pos++;
      }
      const content = body.substring(start, pos);
      chunkCache.set(id, content);
      try {
        results.push(JSON.parse(content) as JsonValue);
      } catch {}
    } else {
      let depth = 0;
      let inString = false;
      let escape = false;
      let i = pos;
      while (i < body.length) {
        const c = body[i++];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\' && inString) {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
          depth--;
          if (depth === 0) {
            try {
              results.push(JSON.parse(body.substring(pos, i)) as JsonValue);
            } catch {}
            pos = i;
            break;
          }
        }
      }
    }
  }
  return results.map(node => resolveNode(node, chunkCache));
}

function resolveNode(node: JsonValue, chunkCache: Map<string, string>): JsonValue {
  if (Array.isArray(node)) return node.map(item => resolveNode(item, chunkCache));
  if (node !== null && typeof node === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = resolveNode(v, chunkCache);
    }
    return out;
  }
  return resolveValue(node, chunkCache);
}

function findSeriesData(node: JsonValue): SeriesPageDto | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findSeriesData(item);
      if (r) return r;
    }
    return null;
  }
  if (node !== null && typeof node === 'object') {
    const o = node as { [key: string]: JsonValue };
    if ('initialManga' in o && 'initialChapters' in o) {
      return {
        initialManga: o.initialManga as unknown as MangaDto,
        initialChapters: o.initialChapters as unknown as ChapterDto[],
      };
    }
    for (const v of Object.values(o)) {
      const r = findSeriesData(v);
      if (r) return r;
    }
  }
  return null;
}

export class DuskscansScraper extends BaseScraper {
  readonly name = 'Dusk Scans';
  readonly baseUrl = BASE_URL;
  readonly lang = 'en';

  private async getCatalog(): Promise<MangaDto[]> {
    const res = await this.get('/api/manga', { headers: { Accept: 'application/json' } });
    return (res.data as MangaDto[]) ?? [];
  }

  private toManga(item: MangaDto): Manga {
    let status: MangaStatus;
    switch (item.status) {
      case 'Ongoing':
        status = 1;
        break;
      case 'Completed':
        status = 0;
        break;
      case 'Hiatus':
        status = 2;
        break;
      default:
        status = undefined;
    }
    return {
      title: item.title,
      url: `/series/${item.slug}`,
      thumbnailUrl: item.cover ?? '',
      author: item.author ?? undefined,
      artist: item.artist ?? undefined,
      description: item.description ?? undefined,
      genre: item.genres.join(', ') || undefined,
      status,
      lang: this.lang,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const mangas = await this.getCatalog();
    const sorted = [...mangas].sort((a, b) => b.views - a.views);
    return { mangas: sorted.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const mangas = await this.getCatalog();
    return { mangas: mangas.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const mangas = await this.getCatalog();
    const q = query.trim().toLowerCase();
    const filtered = mangas
      .filter(item => matchesQuery(item, q))
      .sort((a, b) => b.views - a.views);
    return { mangas: filtered.map(item => this.toManga(item)), hasNextPage: false };
  }

  private async getSeriesPage(slug: string): Promise<SeriesPageDto | null> {
    const res = await this.get(`/series/${slug}`, { headers: { RSC: '1' } });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const payloads = parseRscPayload(body);
    for (const payload of payloads) {
      const found = findSeriesData(payload);
      if (found) return found;
    }
    return null;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/series/')[1] ?? mangaUrl.split('/').pop() ?? '';
    const series = await this.getSeriesPage(slug);
    if (!series) return { url: mangaUrl, lang: this.lang };
    return { ...this.toManga(series.initialManga), url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/series/')[1] ?? mangaUrl.split('/').pop() ?? '';
    const series = await this.getSeriesPage(slug);
    if (!series) return [];
    return series.initialChapters.map(ch => ({
      name: ch.title || `Chapter ${ch.number}`,
      url: ch.id,
      chapterNumber: ch.number,
      dateUpload: parseChapterDate(ch.releaseDate),
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`/api/chapter/${chapterUrl}`, {
      headers: { Accept: 'application/json' },
    });
    const data = res.data as ChapterDetailDto;
    let pages: string[] = [];
    try {
      const parsed = JSON.parse(data.pages);
      if (Array.isArray(parsed)) pages = parsed as string[];
    } catch {}
    return pages.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
