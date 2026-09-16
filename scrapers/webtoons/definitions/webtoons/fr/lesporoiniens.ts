import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const SERIES_DATA_SELECTOR = '#series-data-placeholder';
const READER_DATA_SELECTOR = '#reader-data-placeholder';

interface ConfigResponse {
  LOCAL_SERIES_FILES: string[];
}

interface ChapterData {
  title?: string | null;
  volume?: string | null;
  last_updated: number;
  licencied?: boolean;
  groups?: Record<string, string> | null;
}

interface SeriesData {
  title: string;
  description?: string | null;
  artist?: string | null;
  author?: string | null;
  cover?: string | null;
  tags?: string[] | null;
  release_status?: string | null;
  alternative_titles?: string[] | null;
  chapters?: Record<string, ChapterData> | null;
}

interface LocalReaderData {
  series: {
    chapters?: Record<string, ChapterData> | null;
  };
}

interface PageData {
  link: string;
}

const accentsMap: Record<string, string> = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c', 'ñ': 'n',
};

const nonSlugChars = /[^a-z0-9\s-]/g;
const whitespace = /\s/g;

function toSlug(input: string | null | undefined, slugSeparator = '-'): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .split('')
    .map((c) => accentsMap[c] ?? c)
    .join('')
    .replace(nonSlugChars, '')
    .replace(whitespace, slugSeparator);
}

function parseChaptersField(raw: unknown): Record<string, ChapterData> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const map: Record<string, ChapterData> = {};
    (raw as ChapterData[]).forEach((item, idx) => {
      map[String(idx + 1)] = item;
    });
    return map;
  }
  if (typeof raw === 'object') {
    return raw as Record<string, ChapterData>;
  }
  return null;
}

export class LesporoiniensScraper extends BaseScraper {
  readonly name = 'Les Poroiniens';
  readonly baseUrl = 'https://lesporoiniens.org';
  readonly lang = 'fr';

  private slugAlphanumeric(slug: string): string {
    return slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private toManga(series: SeriesData): Manga {
    return {
      title: series.title,
      url: `/${toSlug(series.title)}`,
      thumbnailUrl: series.cover ? this.absUrl(series.cover) : '',
      lang: this.lang,
    };
  }

  private toDetailedManga(series: SeriesData): Manga {
    const base = this.toManga(series);
    const baseDescription = series.description && !series.description.toLowerCase().includes('pas de synopsis')
      ? series.description
      : undefined;
    const altTitles = series.alternative_titles;
    let description = baseDescription;
    if (altTitles && altTitles.length > 0) {
      const altBlock = `Alternative Titles:\n${altTitles.map((t) => `• ${t}`).join('\n')}`;
      description = baseDescription ? `${baseDescription}\n\n${altBlock}` : altBlock;
    }
    const genre = series.tags?.join(', ') ?? '';
    let status: Manga['status'];
    if (series.release_status === 'En cours') status = 1;
    else if (series.release_status === 'Finis' || series.release_status === 'Fini') status = 0;
    else status = undefined;
    return {
      ...base,
      description,
      author: series.author ?? undefined,
      artist: series.artist ?? undefined,
      genre: genre || undefined,
      status,
    };
  }

  private buildChapterList(series: SeriesData): Chapter[] {
    const chapters = parseChaptersField(series.chapters);
    if (!chapters) return [];
    const mangaUrl = `/${toSlug(series.title)}`;
    const multiple = Object.keys(chapters).length > 1;
    const list: Chapter[] = [];
    for (const [num, data] of Object.entries(chapters)) {
      if (data.licencied) continue;
      const chNum = num;
      let baseName = `Chapter ${chNum}`;
      if (data.title) {
        baseName = multiple ? `Ch. ${chNum} - ${data.title}` : data.title;
        if (data.volume) baseName = `Vol. ${data.volume} ${baseName}`;
      } else if (data.volume) {
        baseName = `Vol. ${data.volume} Ch. ${chNum}`;
      }
      list.push({
        name: baseName,
        url: `${mangaUrl}/${chNum}`,
        chapterNumber: parseFloat(chNum) || -1,
        dateUpload: data.last_updated ? data.last_updated * 1000 : undefined,
      });
    }
    return list.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  private async fetchCatalogue(): Promise<SeriesData[]> {
    const res = await this.get(`${this.baseUrl}/data/config.json`);
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const config = JSON.parse(text) as ConfigResponse;
    return this.fetchSeriesFiles(config.LOCAL_SERIES_FILES);
  }

  private async fetchSeriesFiles(fileNames: string[]): Promise<SeriesData[]> {
    const promises = fileNames.map(async (fileName) => {
      try {
        const res = await this.get(`${this.baseUrl}/data/series/${fileName}`);
        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const raw = JSON.parse(text) as Record<string, unknown>;
        // Handle chapters may be array -> map
        if (raw['chapters'] !== undefined) {
          raw['chapters'] = parseChaptersField(raw['chapters']) ?? raw['chapters'];
        }
        return raw as unknown as SeriesData;
      } catch {
        return null;
      }
    });
    const results = await Promise.all(promises);
    return results.filter((v): v is SeriesData => v !== null);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const catalogue = await this.fetchCatalogue();
    return { mangas: catalogue.map((s) => this.toManga(s)), hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not implemented`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return this.getPopular(page);
    if (page > 1) return { mangas: [], hasNextPage: false };
    const catalogue = await this.fetchCatalogue();
    const lower = trimmed.toLowerCase();
    const matches = catalogue.filter((s) =>
      s.title.toLowerCase().includes(lower) ||
      (s.author?.toLowerCase().includes(lower) ?? false) ||
      (s.artist?.toLowerCase().includes(lower) ?? false) ||
      (s.alternative_titles?.some((t) => t.toLowerCase().includes(lower)) ?? false)
    );
    return { mangas: matches.map((s) => this.toManga(s)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    try {
      const res = await this.get(mangaUrl);
      const $ = this.$(res.data as string);
      const raw = $(SERIES_DATA_SELECTOR).html();
      if (raw) {
        const series = JSON.parse(raw) as SeriesData;
        if (series.chapters !== undefined) {
          const parsed = parseChaptersField(series.chapters as unknown);
          if (parsed) (series as unknown as Record<string, unknown>)['chapters'] = parsed;
        }
        return this.toDetailedManga(series);
      }
    } catch {
      // fallback to catalogue
    }
    // Fallback via catalogue slug search
    try {
      const urlObj = new URL(mangaUrl, this.baseUrl);
      const slug = urlObj.pathname.split('/').filter(Boolean)[0] ?? '';
      if (!slug) return {};
      const wanted = this.slugAlphanumeric(slug);
      const catalogue = await this.fetchCatalogue();
      const match = catalogue.find((s) => this.slugAlphanumeric(toSlug(s.title)) === wanted);
      if (match) return this.toDetailedManga(match);
    } catch {
      // ignore
    }
    return {};
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    try {
      const res = await this.get(mangaUrl);
      const $ = this.$(res.data as string);
      const raw = $(SERIES_DATA_SELECTOR).html();
      if (raw) {
        const series = JSON.parse(raw) as SeriesData;
        if (series.chapters !== undefined) {
          const parsed = parseChaptersField(series.chapters as unknown);
          if (parsed) (series as unknown as Record<string, unknown>)['chapters'] = parsed;
        }
        return this.buildChapterList(series);
      }
    } catch {
      // fallback
    }
    // fallback catalogue
    try {
      const urlObj = new URL(mangaUrl, this.baseUrl);
      const slug = urlObj.pathname.split('/').filter(Boolean)[0] ?? '';
      const wanted = this.slugAlphanumeric(slug);
      const catalogue = await this.fetchCatalogue();
      const match = catalogue.find((s) => this.slugAlphanumeric(toSlug(s.title)) === wanted);
      if (match) return this.buildChapterList(match);
    } catch {
      // ignore
    }
    return [];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const chapterNumber = chapterUrl.trim().replace(/\/$/, '').split('/').pop() ?? '';
    const raw = $(READER_DATA_SELECTOR).html();
    if (!raw) throw new Error(`Reader data not found for chapter ${chapterNumber}`);
    const readerData = JSON.parse(raw) as LocalReaderData;
    const chapters = parseChaptersField(readerData.series.chapters as unknown);
    const chapterData = chapters?.[chapterNumber];
    if (!chapterData) throw new Error(`Chapter ${chapterNumber} not found`);
    const chapterGroups = chapterData.groups;
    if (!chapterGroups) throw new Error(`Chapter URL not found for chapter ${chapterNumber}`);
    const chapterLink = Object.values(chapterGroups)[0];
    if (!chapterLink) throw new Error(`Chapter URL not found for chapter ${chapterNumber}`);

    let imageUrls: string[];
    if (chapterLink.includes('imgchest')) {
      const chapterId = chapterLink.split('/').pop() ?? '';
      const apiRes = await this.get(`${this.baseUrl}/api/imgchest-chapter-pages?id=${encodeURIComponent(chapterId)}`);
      const text = typeof apiRes.data === 'string' ? apiRes.data : JSON.stringify(apiRes.data);
      const pages = JSON.parse(text) as PageData[];
      imageUrls = pages.map((p) => p.link);
    } else {
      const apiRes = await this.get(`${this.baseUrl}${chapterLink}`);
      const text = typeof apiRes.data === 'string' ? apiRes.data : JSON.stringify(apiRes.data);
      const pages = JSON.parse(text) as string[];
      imageUrls = pages;
    }
    return imageUrls.map((url, index) => ({ index, imageUrl: url }));
  }
}
