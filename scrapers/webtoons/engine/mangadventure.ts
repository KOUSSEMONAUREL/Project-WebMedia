import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from './types';

interface MangAdventureSeriesSummary {
  slug: string;
  title: string;
  url?: string;
  cover: string;
  updated?: string;
  chapters?: number | null;
}

interface MangAdventureSeries extends MangAdventureSeriesSummary {
  description?: string | null;
  status?: string | null;
  completed?: boolean;
  licensed?: boolean | null;
  aliases?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  categories?: string[] | null;
  views?: number;
}

interface MangAdventureChapter {
  id: number;
  title: string;
  number: number;
  volume?: number | null;
  published: string;
  final: boolean;
  series: string;
  groups: string[];
  full_title: string;
  url?: string;
  views?: number;
}

interface MangAdventurePage {
  id: number;
  image: string;
  number: number;
  url: string;
}

interface MangAdventurePaginator<T> {
  total?: number;
  last: boolean;
  results: T[];
}

interface MangAdventureResults<T> {
  results: T[];
}

export abstract class MangAdventureScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  protected get apiUrl(): string {
    return `${this.baseUrl}/api/v2`;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/series?page=${page}&sort=-views`);
    return this.parseMangasPage(res.data as MangAdventurePaginator<MangAdventureSeriesSummary>);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/series?page=${page}&sort=-latest_upload`);
    return this.parseMangasPage(res.data as MangAdventurePaginator<MangAdventureSeriesSummary>);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/series?page=${page}&title=${encodeURIComponent(query)}`);
    return this.parseMangasPage(res.data as MangAdventurePaginator<MangAdventureSeriesSummary>);
  }

  protected parseMangasPage(data: MangAdventurePaginator<MangAdventureSeriesSummary>): SearchResult {
    const mangas: Manga[] = data.results.map(s => ({
      title: s.title,
      url: `${this.baseUrl}/reader/${s.slug}`,
      thumbnailUrl: s.cover,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: !data.last };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFromUrl(mangaUrl);
    const res = await this.get(`${this.apiUrl}/series/${slug}`);
    return this.mangaFromJson(res.data as MangAdventureSeries, mangaUrl);
  }

  protected mangaFromJson(series: MangAdventureSeries, mangaUrl: string): Manga {
    let description = series.description ?? undefined;
    const aliases = (series.aliases ?? []).filter(a => a && a.trim().length > 0);
    if (aliases.length > 0) {
      const alt = `Alternative titles:\n${aliases.join('\n')}`;
      description = description ? `${description}\n\n${alt}` : alt;
    }
    return {
      title: series.title,
      url: mangaUrl,
      thumbnailUrl: series.cover,
      lang: this.lang,
      author: (series.authors ?? []).join(', ') || undefined,
      artist: (series.artists ?? []).join(', ') || undefined,
      description,
      genre: (series.categories ?? []).join(', ') || undefined,
      status: this.statusFromJson(series),
    };
  }

  protected statusFromJson(series: MangAdventureSeries): MangaStatus {
    if (series.licensed === true) return 3;
    switch (series.status) {
      case 'completed': return 0;
      case 'ongoing': return 1;
      case 'canceled': return 2;
      case 'hiatus': return 3;
      default: return 3;
    }
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    const res = await this.get(`${this.apiUrl}/series/${slug}/chapters?date_format=timestamp`);
    const data = res.data as MangAdventureResults<MangAdventureChapter>;
    return data.results.map(ch => this.chapterFromJson(ch));
  }

  protected chapterFromJson(chapter: MangAdventureChapter): Chapter {
    const published = Number.parseInt(chapter.published, 10);
    return {
      name: chapter.final ? `${chapter.full_title} [END]` : chapter.full_title,
      url: `${this.apiUrl}/chapters/${chapter.id}/read`,
      chapterNumber: chapter.number,
      scanlator: chapter.groups.join(', ') || undefined,
      dateUpload: Number.isNaN(published) ? undefined : published,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = this.chapterIdFromUrl(chapterUrl);
    const res = await this.get(`${this.apiUrl}/chapters/${id}/pages?track=true`);
    const data = res.data as MangAdventureResults<MangAdventurePage>;
    return data.results.map((page, index) => ({
      index,
      imageUrl: page.image,
    }));
  }

  protected slugFromUrl(mangaUrl: string): string {
    const clean = mangaUrl.split('?')[0].replace(/\/+$/, '');
    const segments = clean.split('/').filter(Boolean);
    const readerIdx = segments.indexOf('reader');
    if (readerIdx >= 0 && readerIdx + 1 < segments.length) {
      return segments[readerIdx + 1];
    }
    return segments[segments.length - 1] ?? '';
  }

  protected chapterIdFromUrl(chapterUrl: string): string {
    const match = chapterUrl.match(/\/chapters\/(\d+)/);
    if (match) return match[1];
    const trailing = chapterUrl.match(/(\d+)\/?$/);
    if (trailing) return trailing[1];
    return chapterUrl;
  }
}
