import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface CatalogEntry {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  author: string;
  status: string;
  genres: string[];
  latestChapter?: { releaseDate?: string | null } | null;
}

interface ChapterEntry {
  id: string;
  number: number;
  title: string;
  pages: string[];
  releaseDate?: string | null;
}

const CATALOG_START = /\[\{id\s*:/g;

class JsLiteralParser {
  private position: number;

  constructor(private readonly source: string, startIndex: number) {
    this.position = startIndex;
  }

  parse(): JsonValue {
    this.skipWhitespace();
    return this.parseValue();
  }

  private parseValue(): JsonValue {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === "'" || char === '"') return this.parseString();
    if (char === '-' || char === '+' || (char >= '0' && char <= '9')) return this.parseNumber();
    return this.parseKeyword();
  }

  private parseObject(): { [key: string]: JsonValue } {
    this.expect('{');
    this.skipWhitespace();
    const values: { [key: string]: JsonValue } = {};
    if (this.consume('}')) return values;

    while (true) {
      this.skipWhitespace();
      const char = this.peek();
      const key = char === "'" || char === '"' ? this.parseString() : this.parseIdentifier();
      this.skipWhitespace();
      this.expect(':');
      values[key] = this.parseValue();
      this.skipWhitespace();
      if (this.consume('}')) break;
      this.expect(',');
      this.skipWhitespace();
      if (this.consume('}')) break;
    }
    return values;
  }

  private parseArray(): JsonValue[] {
    this.expect('[');
    this.skipWhitespace();
    const values: JsonValue[] = [];
    if (this.consume(']')) return values;

    while (true) {
      values.push(this.parseValue());
      this.skipWhitespace();
      if (this.consume(']')) break;
      this.expect(',');
      this.skipWhitespace();
      if (this.consume(']')) break;
    }
    return values;
  }

  private parseString(): string {
    const quote = this.next();
    let result = '';
    while (this.position < this.source.length) {
      const char = this.next();
      if (char === quote) return result;
      if (char !== '\\') {
        result += char;
        continue;
      }
      const escaped = this.next();
      switch (escaped) {
        case "'":
        case '"':
        case '\\':
        case '/':
          result += escaped;
          break;
        case 'b':
          result += '\b';
          break;
        case 'f':
          result += '\f';
          break;
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        case 'v':
          result += '\v';
          break;
        case '0':
          result += '\0';
          break;
        case 'x':
          result += String.fromCharCode(this.readHex(2));
          break;
        case 'u': {
          if (this.consume('{')) {
            const end = this.source.indexOf('}', this.position);
            if (end === -1) this.fail('Unterminated Unicode escape');
            const codePoint = Number.parseInt(this.source.slice(this.position, end), 16);
            if (!Number.isFinite(codePoint)) this.fail('Invalid Unicode escape');
            result += String.fromCodePoint(codePoint);
            this.position = end + 1;
          } else {
            result += String.fromCharCode(this.readHex(4));
          }
          break;
        }
        case '\n':
          break;
        case '\r':
          this.consume('\n');
          break;
        default:
          result += escaped;
      }
    }
    this.fail('Unterminated string');
  }

  private parseNumber(): number {
    const start = this.position;
    if (this.peek() === '+' || this.peek() === '-') this.position++;
    while (this.position < this.source.length && this.isDigit(this.source[this.position])) this.position++;
    if (this.position < this.source.length && this.source[this.position] === '.') {
      this.position++;
      while (this.position < this.source.length && this.isDigit(this.source[this.position])) this.position++;
    }
    if (this.position < this.source.length && 'eE'.includes(this.source[this.position])) {
      this.position++;
      if (this.position < this.source.length && '+-'.includes(this.source[this.position])) this.position++;
      while (this.position < this.source.length && this.isDigit(this.source[this.position])) this.position++;
    }
    const value = Number.parseFloat(this.source.slice(start, this.position));
    if (!Number.isFinite(value)) this.fail('Invalid number');
    return value;
  }

  private parseKeyword(): JsonValue {
    const value = this.parseIdentifier();
    switch (value) {
      case 'true':
        return true;
      case 'false':
        return false;
      case 'null':
      case 'undefined':
        return null;
      case 'void':
        this.parseValue();
        return null;
      default:
        this.fail(`Unsupported value '${value}'`);
    }
  }

  private parseIdentifier(): string {
    const start = this.position;
    while (this.position < this.source.length) {
      const char = this.source[this.position];
      if (!/[A-Za-z0-9_$]/.test(char)) break;
      this.position++;
    }
    if (this.position === start) this.fail('Expected identifier');
    return this.source.slice(start, this.position);
  }

  private readHex(length: number): number {
    const value = Number.parseInt(this.source.slice(this.position, this.position + length), 16);
    if (!Number.isFinite(value)) this.fail('Invalid hexadecimal escape');
    this.position += length;
    return value;
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length && /\s/.test(this.source[this.position])) this.position++;
  }

  private peek(): string {
    if (this.position >= this.source.length) this.fail('Unexpected end of input');
    return this.source[this.position];
  }

  private next(): string {
    const char = this.peek();
    this.position++;
    return char;
  }

  private expect(expected: string): void {
    if (!this.consume(expected)) this.fail(`Expected '${expected}'`);
  }

  private consume(expected: string): boolean {
    if (this.source[this.position] !== expected) return false;
    this.position++;
    return true;
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private fail(message: string): never {
    throw new Error(`${message} at position ${this.position}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCatalogEntry(value: unknown): CatalogEntry | null {
  if (!isRecord(value)) return null;
  const { id, slug, title, description, coverImage, author, status, genres, latestChapter } = value;
  if (typeof id !== 'string' || typeof slug !== 'string' || typeof title !== 'string') return null;
  if (!slug || !title) return null;
  return {
    id,
    slug,
    title,
    description: typeof description === 'string' ? description : '',
    coverImage: typeof coverImage === 'string' ? coverImage : '',
    author: typeof author === 'string' ? author : '',
    status: typeof status === 'string' ? status : '',
    genres: Array.isArray(genres) ? genres.filter((g): g is string => typeof g === 'string') : [],
    latestChapter: isRecord(latestChapter)
      ? { releaseDate: typeof latestChapter.releaseDate === 'string' ? latestChapter.releaseDate : null }
      : null,
  };
}

function toChapterEntry(value: unknown): ChapterEntry | null {
  if (!isRecord(value)) return null;
  const { id, number, title, pages, releaseDate } = value;
  if (typeof id !== 'string' || typeof number !== 'number') return null;
  return {
    id,
    number,
    title: typeof title === 'string' ? title : '',
    pages: Array.isArray(pages) ? pages.filter((p): p is string => typeof p === 'string') : [],
    releaseDate: typeof releaseDate === 'string' ? releaseDate : null,
  };
}

function parseStatus(status: string): MangaStatus {
  switch (status.toLowerCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ')) {
    case 'ongoing':
    case 'publishing':
    case 'releasing':
    case 'active':
      return 1;
    case 'completed':
    case 'complete':
    case 'finished':
      return 0;
    case 'hiatus':
    case 'on hiatus':
    case 'paused':
      return 2;
    case 'cancelled':
    case 'canceled':
    case 'dropped':
    case 'axed':
    case 'discontinued':
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

export class MangalixScraper extends BaseScraper {
  readonly name = 'MangaLix';
  readonly baseUrl = 'https://mangalix.com';
  readonly lang = 'en';

  private cachedCatalog?: CatalogEntry[];

  private resolveImageUrl(url: string): string {
    const prefixes: Array<[string, string]> = [
      ['$TEMP', 'https://temp.compsci88.com'],
      ['$HOT', 'https://scans-hot.planeptune.us'],
      ['$LST', 'https://scans.lastation.us'],
      ['$LOW', 'https://official.lowee.us'],
      ['$MFK', 'https://images.mangafreak.me'],
    ];
    for (const [prefix, replacement] of prefixes) {
      if (url.startsWith(prefix)) return url.replace(prefix, replacement);
    }
    if (url.startsWith('/cdn-readmanga/')) {
      return `https://cdn.readmanga.cc${url.replace('/cdn-readmanga', '')}`;
    }
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${this.baseUrl}${url}`;
    return url;
  }

  private resolveCover(url: string): string {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return `https:${url}`;
    return `${this.baseUrl}/${url.replace(/^\/+/, '')}`;
  }

  private async loadCatalog(): Promise<CatalogEntry[]> {
    if (this.cachedCatalog) return this.cachedCatalog;
    const home = await this.get(this.baseUrl);
    const $ = this.$(home.data as string);
    const scriptUrl = $('link[rel=modulepreload][href*="/assets/manga-data-"]').first().attr('href');
    if (!scriptUrl) throw new Error('MangaLix: catalog script not found');
    const script = await this.get(this.absUrl(scriptUrl));
    const source = script.data as string;

    for (const match of source.matchAll(CATALOG_START)) {
      try {
        const parsed = new JsLiteralParser(source, match.index ?? 0).parse();
        if (!Array.isArray(parsed)) continue;
        const entries = parsed.map(toCatalogEntry);
        if (
          entries.length > 0
          && entries.every((entry): entry is CatalogEntry => entry !== null)
        ) {
          this.cachedCatalog = entries.filter(
            (entry, index, all) => all.findIndex(other => other.slug === entry.slug) === index,
          );
          return this.cachedCatalog;
        }
      } catch {
        continue;
      }
    }
    throw new Error('MangaLix: manga catalog not found');
  }

  private toManga(entry: CatalogEntry): Manga {
    return {
      title: entry.title,
      url: `/manga/${entry.slug}`,
      thumbnailUrl: this.resolveCover(entry.coverImage),
      lang: this.lang,
      author: entry.author || undefined,
      description: entry.description || undefined,
      genre: entry.genres.join(', ') || undefined,
      status: parseStatus(entry.status),
    };
  }

  private latestTimestamp(entry: CatalogEntry): number {
    return parseDate(entry.latestChapter?.releaseDate) ?? 0;
  }

  private async searchCatalog(query: string): Promise<CatalogEntry[]> {
    const catalog = await this.loadCatalog();
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return catalog;
    return catalog.filter(entry => {
      const searchable = `${entry.title} ${entry.author} ${entry.slug}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
  }

  async getPopular(): Promise<SearchResult> {
    const catalog = await this.loadCatalog();
    return { mangas: catalog.map(entry => this.toManga(entry)), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    const catalog = await this.loadCatalog();
    const sorted = catalog.slice().sort((a, b) => this.latestTimestamp(b) - this.latestTimestamp(a));
    return { mangas: sorted.map(entry => this.toManga(entry)), hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const matches = await this.searchCatalog(query);
    return { mangas: matches.map(entry => this.toManga(entry)), hasNextPage: false };
  }

  private slugFromUrl(mangaUrl: string): string {
    return mangaUrl.split('/').filter(Boolean).pop() ?? '';
  }

  private async findEntry(mangaUrl: string): Promise<CatalogEntry | null> {
    const slug = this.slugFromUrl(mangaUrl);
    const catalog = await this.loadCatalog();
    return catalog.find(entry => entry.slug === slug) ?? null;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const entry = await this.findEntry(mangaUrl);
    if (!entry) return { url: mangaUrl, lang: this.lang };
    return { ...this.toManga(entry), url: mangaUrl };
  }

  private async readChapters(slug: string): Promise<ChapterEntry[]> {
    const res = await this.get(`/chapters/${encodeURIComponent(slug)}.json`, {
      headers: { Accept: 'application/json' },
    });
    const data: unknown = res.data;
    if (!Array.isArray(data)) return [];
    return data.map(toChapterEntry).filter((entry): entry is ChapterEntry => entry !== null);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    const chapters = await this.readChapters(slug);
    return chapters.slice().reverse().map(chapter => {
      const number = String(chapter.number).replace(/\.0$/, '');
      return {
        name: chapter.title.trim() || `Chapter ${number}`,
        url: `/manga/${slug}/chapter/${number}`,
        chapterNumber: chapter.number,
        dateUpload: parseDate(chapter.releaseDate),
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('/').filter(Boolean);
    const slug = parts[parts.indexOf('manga') + 1] ?? '';
    const number = Number.parseFloat(parts[parts.indexOf('chapter') + 1] ?? '');
    if (!slug || !Number.isFinite(number)) return [];
    const chapters = await this.readChapters(slug);
    const chapter = chapters.find(entry => entry.number === number);
    if (!chapter) return [];
    return chapter.pages.map((url, index) => ({
      index,
      imageUrl: this.resolveImageUrl(url),
    }));
  }
}

export default MangalixScraper;
