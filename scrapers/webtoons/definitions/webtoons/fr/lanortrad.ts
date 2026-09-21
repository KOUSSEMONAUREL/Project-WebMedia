import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface LanorDto {
  id: string;
  title: string;
  type?: string;
  lastUpdate?: string;
  genres?: string[];
  status?: string;
  description?: string;
  cover?: string;
  author?: string;
  artist?: string;
}

const COMMENT_REGEX = /^\s*\/\/.*$/gm;
const CHAPTER_PAGES_REGEX = /window\.CHAPTER_PAGES\s*=\s*(\{.*?\});/s;
const CHAPTER_FILES_REGEX = /window\.CHAPTER_FILES\[[^\]]*]\s*=\s*(\{.*?\});/s;
const COMBINING_MARKS_REGEX = /\p{Mn}+/gu;
const NON_ALNUM_REGEX = /[^A-Za-z0-9]+/g;

function quoteUnquotedKeys(input: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < input.length) {
    const c = input[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < input.length) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (/[A-Za-z0-9_]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      let k = j;
      while (k < input.length && /\s/.test(input[k])) k++;
      if (k < input.length && input[k] === ':') {
        out += `"${input.slice(i, j)}":`;
        i = k + 1;
      } else {
        out += input.slice(i, j);
        i = j;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS_REGEX, '')
    .replace(NON_ALNUM_REGEX, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function parseStatus(s: string | undefined): MangaStatus {
  const v = (s || '').toLowerCase();
  if (v === 'en cours') return 1;
  if (v === 'terminé') return 0;
  if (v === 'en pause') return 3;
  if (v === 'annulé') return 2;
  return undefined;
}

export class LanortradScraper extends BaseScraper {
  readonly name = 'LanorTrad';
  readonly baseUrl = 'https://lanortrad.com';
  readonly lang = 'fr';

  private seriesCache: LanorDto[] | null = null;
  private seriesCacheTime = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000;

  private async fetchSeries(): Promise<LanorDto[]> {
    const now = Date.now();
    if (this.seriesCache && now - this.seriesCacheTime < this.CACHE_TTL) return this.seriesCache;
    const res = await this.get('/js/data/series.js');
    const body: string = res.data as string;
    const cleaned = (body as string).replace(COMMENT_REGEX, '');
    const after = cleaned.split('window.SERIES =')[1];
    if (!after) throw new Error('SERIES not found');
    const jsonStr = after.substring(0, after.lastIndexOf(';')).trim();
    const quoted = quoteUnquotedKeys(jsonStr);
    const arr = JSON.parse(quoted) as LanorDto[];
    this.seriesCache = arr;
    this.seriesCacheTime = now;
    return arr;
  }

  private dtoToManga(dto: LanorDto): Manga {
    const thumb = dto.cover
      ? dto.cover.startsWith('http')
        ? dto.cover
        : `${this.baseUrl}/${dto.cover.replace(/^\//, '')}`
      : '';
    return {
      title: dto.title,
      url: dto.id,
      thumbnailUrl: thumb,
      description: dto.description,
      author: dto.author,
      artist: dto.artist,
      status: parseStatus(dto.status),
      lang: this.lang,
    };
  }

  override async getPopular(): Promise<SearchResult> {
    const series = await this.fetchSeries();
    return { mangas: series.map((d) => this.dtoToManga(d)), hasNextPage: false };
  }

  override async getLatest(): Promise<SearchResult> {
    const series = await this.fetchSeries();
    const sorted = [...series].sort((a, b) => {
      const da = a.lastUpdate || '';
      const db = b.lastUpdate || '';
      return db.localeCompare(da);
    });
    return { mangas: sorted.map((d) => this.dtoToManga(d)), hasNextPage: false };
  }

  override async getSearch(query: string): Promise<SearchResult> {
    const series = await this.fetchSeries();
    const filtered = query.trim()
      ? series.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
      : series;
    return { mangas: filtered.map((d) => this.dtoToManga(d)), hasNextPage: false };
  }

  override async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.includes('/') ? mangaUrl.split('/').pop() || mangaUrl : mangaUrl;
    const series = await this.fetchSeries();
    const dto = series.find((d) => d.id === mangaUrl || d.id === id || slugify(d.id) === slugify(id));
    if (!dto) {
      const fallback = series.find((d) => slugify(d.id) === slugify(mangaUrl));
      if (fallback) return this.dtoToManga(fallback);
      return { title: id, url: mangaUrl, lang: this.lang };
    }
    return this.dtoToManga(dto);
  }

  private async fetchChapterData(): Promise<{ index: Record<string, unknown>; pages: Record<string, string> }> {
    const res = await this.get('/js/data/chapters.js');
    const body: string = res.data as string;
    // extract expand({...})
    const expandStart = body.indexOf('return expand(');
    if (expandStart === -1) throw new Error('expand not found');
    const after = body.substring(expandStart + 'return expand('.length);
    // Find matching closing "})();" -> the expand argument is an object; we can locate by finding last "})();"
    const endMarker = '})();';
    const endIdx = body.lastIndexOf(endMarker);
    if (endIdx === -1) throw new Error('expand end not found');
    // The object string is from after start to endIdx - expandStart - 'return expand('.length + 1 (include closing })
    // Simpler: extract between "return expand(" and "\n});" using manual bracket counting
    let depth = 0;
    let objEnd = -1;
    let startObj = -1;
    for (let i = expandStart; i < body.length; i++) {
      if (body[i] === '{' && startObj === -1) startObj = i;
      if (startObj !== -1) {
        if (body[i] === '{') depth++;
        if (body[i] === '}') depth--;
        if (depth === 0) { objEnd = i; break; }
      }
    }
    if (startObj === -1 || objEnd === -1) throw new Error('chapter index object not found');
    const indexStr = body.substring(startObj, objEnd + 1);
    const quoted = quoteUnquotedKeys(indexStr);
    const index = JSON.parse(quoted) as Record<string, unknown>;

    const pagesMatch = body.match(CHAPTER_PAGES_REGEX);
    const pages: Record<string, string> = pagesMatch ? (JSON.parse(pagesMatch[1] as string) as Record<string, string>) : {};

    return { index, pages };
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const seriesId = mangaUrl.includes('/') ? mangaUrl.split('/').pop() || mangaUrl : mangaUrl;
    // resolve actual id via series list (handle slug vs id)
    const series = await this.fetchSeries();
    const dto = series.find((d) => d.id === mangaUrl || d.id === seriesId || slugify(d.id) === slugify(seriesId));
    const realId = dto ? dto.id : seriesId;
    const data = await this.fetchChapterData();
    const entry = (data.index as Record<string, unknown>)[realId] as { p?: string; c?: unknown[] } | undefined;
    if (!entry || !Array.isArray(entry.c)) return [];
    const defaultPrefix: string = entry.p || '';
    // entries are like ["169",34,{"w":...}] etc. But Kotlin builds via array [num, pagesCount, opts]
    // opts may contain f, p, d etc. We simplify chapter names
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const raw of entry.c) {
      if (!Array.isArray(raw) || raw.length === 0) continue;
      const num = String(raw[0]);
      if (seen.has(num)) continue;
      seen.add(num);
      const opts = raw[2] as Record<string, unknown> | undefined;
      const dateStr = opts?.['d'] as string | undefined;
      const dateUpload = dateStr ? new Date(dateStr).getTime() : undefined;
      const isOneShot = dto?.type?.toLowerCase() === 'oneshot';
      const name = isOneShot ? 'Oneshot' : `Chapitre ${num}`;
      chapters.push({
        name,
        url: `${realId}/${num}`,
        chapterNumber: parseFloat(num) || undefined,
        dateUpload,
      });
    }
    // sort descending by chapter_number
    chapters.sort((a, b) => (b.chapterNumber || 0) - (a.chapterNumber || 0));
    // collapse oneshot to single
    if (dto?.type?.toLowerCase() === 'oneshot' && chapters.length > 1) {
      const first = chapters[0];
      if (first) return [first];
    }
    // also need defaultPrefix is used for page folder but not needed here
    void defaultPrefix;
    return chapters;
  }

  override async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('/');
    const num = parts.pop() || '';
    const seriesId = parts.join('/') || parts[0] || '';
    if (!seriesId || !num) return [];
    const series = await this.fetchSeries();
    const dto = series.find((d) => d.id === seriesId || slugify(d.id) === slugify(seriesId));
    const realId = dto ? dto.id : seriesId;
    const data = await this.fetchChapterData();
    const entry = (data.index as Record<string, unknown>)[realId] as { p?: string; c?: unknown[]; w?: number; h?: number; t?: string } | undefined;
    const pagesPath = (data.pages as Record<string, string>)[realId];
    if (!entry || !pagesPath) return [];
    // Find folder for this chapter num
    let folder: string | null = null;
    let defaultPrefix = entry.p || '';
    if (Array.isArray(entry.c)) {
      for (const raw of entry.c) {
        if (!Array.isArray(raw) || String(raw[0]) !== num) continue;
        const opts = raw[2] as Record<string, unknown> | undefined;
        if (opts && typeof opts['f'] === 'string') folder = opts['f'] as string;
        else if (opts && typeof opts['p'] === 'string') folder = (opts['p'] as string) + num;
        else folder = defaultPrefix + num;
        break;
      }
    }
    if (!folder) return [];
    const res = await this.get(`/${pagesPath}`);
    const body: string = res.data as string;
    const m = body.match(CHAPTER_FILES_REGEX);
    if (!m) {
      // alternative: whole file may be JSON after "window.CHAPTER_FILES[...]= "
      const alt = body.substring(body.indexOf('{'));
      const jsonStr = alt.substring(0, alt.lastIndexOf(';')).trim();
      try {
        const obj = JSON.parse(jsonStr) as Record<string, { f: string[] }>;
        const files = obj[num]?.f || [];
        return files.map((f, idx) => ({ index: idx, imageUrl: this.buildImageUrl(realId, folder as string, f) }));
      } catch {
        return [];
      }
    }
    try {
      const obj = JSON.parse(m[1] as string) as Record<string, { f: string[] }>;
      const files: string[] = obj[num]?.f || [];
      return files.map((f, idx) => ({ index: idx, imageUrl: this.buildImageUrl(realId, folder as string, f) }));
    } catch {
      return [];
    }
  }

  private buildImageUrl(seriesId: string, folder: string, file: string): string {
    const parts = ['Manga', seriesId, ...folder.split('/').filter(Boolean), file];
    return `${this.baseUrl}/${parts.map(encodeURIComponent).join('/')}`.replace(/%2F/g, '/');
  }
}
