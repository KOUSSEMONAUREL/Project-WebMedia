import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface RawSeries {
  id: string;
  title: string;
  category?: string;
  description?: string;
  tenant?: string;
  storageSlug?: string;
  rating: number;
  totalChapters?: number;
  publishedLimit?: number;
  freeLimit?: number;
  isCompleted?: boolean;
  hasChapterZero?: boolean;
  heroImage?: string;
  covers: string[];
}

interface ManifestPage {
  page?: number | string;
  file?: string;
}

interface Manifest {
  pages?: Array<ManifestPage | string>;
}

const IMAGE_BASE_MSC = 'https://img.mangasincensura.com/manhwas';
const IMAGE_BASE_CDN = 'https://cdn.uncensoredmanga.com/manhwas';
const PREMIUM_SLUGS = new Set([
  'viajando_mama',
  'asiento_trasero',
  'tres_hermanas',
  'lecciones_privadas',
  'ciudad_de_milfs',
  'conviviendo',
  'duena_pension',
  'fitness',
  'mis_tres_animadoras',
  'amame_suavemente',
  'circulo_vicioso',
  'deseos_inmorales',
  'necesidades_mama',
]);

export class MangasSinCensuraScraper extends BaseScraper {
  readonly name = 'MangasSinCensura';
  readonly baseUrl = 'https://mangasincensura.com';
  readonly lang = 'es';

  private seriesPromise?: Promise<RawSeries[]>;

  private loadSeries(): Promise<RawSeries[]> {
    if (!this.seriesPromise) {
      this.seriesPromise = this.fetchSeries().catch(error => {
        this.seriesPromise = undefined;
        throw error;
      });
    }
    return this.seriesPromise;
  }

  private async fetchSeries(): Promise<RawSeries[]> {
    const index = await this.get(this.absUrl('/manhwa_index'));
    const $ = this.$(index.data);
    const dataPath =
      $('link[rel="modulepreload"][href*="/assets/manhwa-data-"]').attr('href') ??
      $('script[src*="/assets/manhwa-data-"]').attr('src');

    if (!dataPath) throw new Error(`${this.name}: manhwa-data asset not found`);

    const data = await this.get(this.absUrl(dataPath));
    const source = typeof data.data === 'string' ? data.data : String(data.data);
    return this.parseSeries(source);
  }

  private parseSeries(source: string): RawSeries[] {
    const declaration = /\bconst\s+[A-Za-z_$][\w$]*\s*=\s*\{/.exec(source);
    if (!declaration) throw new Error(`${this.name}: series object not found`);

    const start = source.indexOf('{', declaration.index);
    const outer = this.objectAt(source, start);
    const entries = this.splitEntries(outer.body);
    const seen = new Set<string>();
    const series: RawSeries[] = [];

    for (const body of entries) {
      const id = this.stringField(body, 'id');
      const title = this.stringField(body, 'title');
      if (!id || !title || seen.has(id)) continue;

      seen.add(id);
      series.push({
        id,
        title,
        category: this.stringField(body, 'category'),
        description: this.stringField(body, 'description'),
        tenant: this.stringField(body, 'tenant'),
        storageSlug: this.stringField(body, 'storageSlug'),
        rating: this.numberField(body, 'rating') ?? 0,
        totalChapters: this.numberField(body, 'totalChapters'),
        publishedLimit: this.numberField(body, 'publishedLimit'),
        freeLimit: this.numberField(body, 'freeLimit'),
        isCompleted: this.booleanField(body, 'isCompleted'),
        hasChapterZero: this.booleanField(body, 'hasChapterZero'),
        heroImage: this.stringField(body, 'heroImage'),
        covers: this.stringArrayField(body, 'covers'),
      });
    }

    return series;
  }

  private objectAt(source: string, start: number): { body: string; end: number } {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) return { body: source.slice(start + 1, i), end: i };
      }
    }

    throw new Error(`${this.name}: unterminated object`);
  }

  private splitEntries(body: string): string[] {
    const entries: string[] = [];
    let cursor = 0;

    while (cursor < body.length) {
      while (cursor < body.length && /[\s,]/.test(body[cursor])) cursor += 1;
      if (cursor >= body.length) break;

      const colon = body.indexOf(':', cursor);
      if (colon < 0) break;

      let start = colon + 1;
      while (start < body.length && /\s/.test(body[start])) start += 1;
      if (body[start] !== '{') break;

      const entry = this.objectAt(body, start);
      entries.push(entry.body);
      cursor = entry.end + 1;
    }

    return entries;
  }

  private rawStringField(body: string, key: string): string | undefined {
    const match = new RegExp(`(?:^|[,{])${key}:"((?:\\\\.|[^"\\\\])*)"`).exec(body);
    return match?.[1];
  }

  private stringField(body: string, key: string): string | undefined {
    const raw = this.rawStringField(body, key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      return raw;
    }
  }

  private numberField(body: string, key: string): number | undefined {
    const match = new RegExp(`(?:^|[,{])${key}:(-?[0-9.]+)`).exec(body);
    if (!match) return undefined;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : undefined;
  }

  private booleanField(body: string, key: string): boolean | undefined {
    const match = new RegExp(`(?:^|[,{])${key}:(!0|!1|true|false)`).exec(body);
    if (!match) return undefined;
    return match[1] === '!0' || match[1] === 'true';
  }

  private stringArrayField(body: string, key: string): string[] {
    const match = new RegExp(`(?:^|[,{])${key}:\\[([^\\]]*)\\]`).exec(body);
    if (!match) return [];

    const values: string[] = [];
    const stringPattern = /"((?:\\.|[^"\\])*)"/g;
    let item = stringPattern.exec(match[1]);
    while (item) {
      try {
        values.push(JSON.parse(`"${item[1]}"`) as string);
      } catch {
        values.push(item[1]);
      }
      item = stringPattern.exec(match[1]);
    }
    return values;
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  private toManga(item: RawSeries): Manga {
    return {
      title: item.title,
      url: this.absUrl(`/manhwa_index?id=${encodeURIComponent(item.id)}`),
      thumbnailUrl: this.absUrl(item.heroImage ?? item.covers[0] ?? ''),
      lang: this.lang,
      genre: item.category,
      description: item.description,
      status: item.isCompleted ? 0 : 1,
    };
  }

  private async findSeries(id: string): Promise<RawSeries | undefined> {
    const series = await this.loadSeries();
    return series.find(item => item.id === id);
  }

  private idFromUrl(input: string, key: 'manhwa' | 'id'): string | undefined {
    try {
      const url = new URL(input, this.baseUrl);
      return url.searchParams.get(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async listFrom(items: RawSeries[]): Promise<SearchResult> {
    return { mangas: items.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const series = await this.loadSeries();
    return this.listFrom([...series].sort((a, b) => b.rating - a.rating));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    return this.listFrom(await this.loadSeries());
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };

    const words = this.normalize(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.getLatest(page);

    const series = await this.loadSeries();
    return this.listFrom(series.filter(item => {
      const haystack = this.normalize(`${item.title} ${item.category ?? ''}`);
      return words.every(word => haystack.includes(word));
    }));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.idFromUrl(mangaUrl, 'id');
    if (!id) return {};

    const item = await this.findSeries(id);
    if (!item) return {};

    return {
      ...this.toManga(item),
      url: this.absUrl(mangaUrl),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.idFromUrl(mangaUrl, 'id');
    if (!id) return [];

    const item = await this.findSeries(id);
    if (!item) return [];

    const end = item.publishedLimit ?? item.totalChapters ?? 0;
    const start = item.hasChapterZero ? 0 : 1;
    const chapters: Chapter[] = [];

    for (let number = start; number <= end; number += 1) {
      const locked = item.freeLimit !== undefined && number > item.freeLimit;
      const cap = String(number).padStart(2, '0');
      chapters.push({
        name: `${locked ? '🔒 ' : ''}Capítulo ${number}`,
        url: this.absUrl(`/chapter?manhwa=${encodeURIComponent(item.id)}&cap=${cap}`),
        chapterNumber: number,
      });
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = this.idFromUrl(chapterUrl, 'manhwa');
    const chapterValue = new URL(chapterUrl, this.baseUrl).searchParams.get('cap');
    const chapter = Number(chapterValue);

    if (!id || !Number.isInteger(chapter)) return [];

    const item = await this.findSeries(id);
    if (!item) return [];

    if (item.freeLimit !== undefined && chapter > item.freeLimit) {
      throw new Error(`${this.name}: chapter ${chapter} is VIP-only`);
    }

    const end = item.publishedLimit ?? item.totalChapters ?? 0;
    if (chapter < 0 || chapter > end) return [];

    const storageSlug = item.storageSlug ?? item.id;
    const useMscHost = item.tenant === 'msc' || PREMIUM_SLUGS.has(item.id) || PREMIUM_SLUGS.has(storageSlug);
    const base = useMscHost ? IMAGE_BASE_MSC : IMAGE_BASE_CDN;
    const chapterDir = `ch${String(chapter).padStart(3, '0')}`;
    const manifestUrl = `${base}/${storageSlug}/${chapterDir}/manifest.json`;
    const proxied = this.absUrl(`/api/manifest?url=${encodeURIComponent(manifestUrl)}`);

    const response = await this.get(proxied, { headers: { Accept: 'application/json' } });
    const payload: Manifest = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    const rawPages = Array.isArray(payload.pages) ? payload.pages : [];

    const files = rawPages.map(entry => {
      if (typeof entry === 'string') return entry;
      if (typeof entry.page === 'string') return entry.page.endsWith('.webp') ? entry.page : `${entry.page}.webp`;
      if (entry.file) return entry.file;
      if (entry.page !== undefined) return `${String(entry.page).padStart(4, '0')}.webp`;
      return '';
    }).filter(Boolean);

    const selected =
      item.id === 'viajando_mama' && (chapter === 0 || chapter === 1) && files.length % 2 === 0
        ? files.filter((_, index) => index % 2 === 0)
        : files;

    return selected.map((file, index) => ({
      imageUrl: `${base}/${storageSlug}/${chapterDir}/${file}`,
      index,
    }));
  }
}
