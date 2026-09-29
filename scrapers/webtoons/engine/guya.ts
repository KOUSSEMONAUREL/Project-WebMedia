import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

export interface GuyaSeriesDto {
  slug: string;
  title?: string | null;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  cover?: string | null;
  last_updated?: number | null;
}

export interface GuyaSeriesDetailsDto {
  slug: string;
  title: string;
  author?: string | null;
  artist?: string | null;
  description?: string | null;
  cover?: string | null;
  groups: Record<string, string>;
  chapters: Record<string, GuyaChapterDto>;
  preferred_sort?: string[] | null;
}

export interface GuyaChapterDto {
  title: string;
  folder: string;
  groups: Record<string, string[]>;
  release_date?: Record<string, number> | null;
  preferred_sort?: string[] | null;
}

const SLUG_PREFIX = 'slug:';
const DEFAULT_SCANLATOR_ID = '1';

export abstract class GuyaScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  protected filterMangas(result: SearchResult): SearchResult {
    return result;
  }

  private async fetchAllSeries(): Promise<Record<string, GuyaSeriesDto>> {
    const res = await this.get(`${this.baseUrl}/api/get_all_series/`);
    return res.data as Record<string, GuyaSeriesDto>;
  }

  private async fetchSeries(slug: string): Promise<GuyaSeriesDetailsDto> {
    const res = await this.get(`${this.baseUrl}/api/series/${slug}/`);
    return res.data as GuyaSeriesDetailsDto;
  }

  private extractSlug(mangaUrl: string): string {
    if (mangaUrl.startsWith('http://') || mangaUrl.startsWith('https://')) {
      const segments = new URL(mangaUrl).pathname.split('/').filter(Boolean);
      const seriesIdx = segments.indexOf('series');
      if (seriesIdx >= 0 && segments.length > seriesIdx + 1) {
        return segments[seriesIdx + 1];
      }
      return segments[segments.length - 1] ?? mangaUrl;
    }
    return mangaUrl.replace(/^\/+|\/+$/g, '').split('/').pop() || mangaUrl;
  }

  private parseMangaList(payload: Record<string, GuyaSeriesDto>): SearchResult {
    const mangas = Object.entries(payload).map(([title, series]) =>
      this.seriesDtoToManga(series, title),
    );
    return this.filterMangas({ mangas, hasNextPage: false });
  }

  private seriesDtoToManga(series: GuyaSeriesDto, title: string): Manga {
    return {
      title,
      url: series.slug,
      thumbnailUrl: this.toCoverUrl(series.cover) || '',
      lang: this.lang,
      author: series.author || undefined,
      artist: series.artist || undefined,
      description: series.description ? this.cleanDescription(series.description) : undefined,
    };
  }

  private seriesDetailsToManga(series: GuyaSeriesDetailsDto): Manga {
    return {
      title: series.title,
      url: series.slug,
      thumbnailUrl: this.toCoverUrl(series.cover) || '',
      lang: this.lang,
      author: series.author || undefined,
      artist: series.artist || undefined,
      description: series.description ? this.cleanDescription(series.description) : undefined,
    };
  }

  private cleanDescription(description: string): string {
    if (!description.includes('<')) return description;
    const $ = this.$(description);
    $('a').remove();
    return $.text();
  }

  private toCoverUrl(cover: string | null | undefined): string | undefined {
    if (!cover) return undefined;
    if (cover.startsWith('http')) return cover;
    return `${this.baseUrl}/${cover}`;
  }

  private getBestScanlator(groupIds: string[], sort: string[]): string {
    if (groupIds.includes(DEFAULT_SCANLATOR_ID)) return DEFAULT_SCANLATOR_ID;
    return sort.find(id => groupIds.includes(id)) ?? groupIds[0];
  }

  private parseChapterList(series: GuyaSeriesDetailsDto, slug: string): Chapter[] {
    const list: Chapter[] = [];

    for (const [chapterNum, dto] of Object.entries(series.chapters)) {
      const sort = dto.preferred_sort ?? series.preferred_sort ?? null;
      if (sort !== null) {
        list.push(this.parseChapterFromJson(dto, chapterNum, sort, series));
      } else {
        for (const groupNum of Object.keys(dto.groups)) {
          const releaseDate = dto.release_date?.[groupNum];
          const parsedNum = parseFloat(chapterNum);
          list.push({
            name: `${chapterNum} - ${dto.title}`,
            url: `${slug}/${chapterNum}`,
            chapterNumber: Number.isNaN(parsedNum) ? undefined : parsedNum,
            scanlator: series.groups[groupNum],
            dateUpload: releaseDate !== undefined ? releaseDate * 1000 : undefined,
          });
        }
      }
    }

    return list.reverse();
  }

  private parseChapterFromJson(
    dto: GuyaChapterDto,
    num: string,
    sort: string[],
    series: GuyaSeriesDetailsDto,
  ): Chapter {
    const groupIds = Object.keys(dto.groups);
    const firstGroupId = this.getBestScanlator(groupIds, sort);
    const releaseDate = dto.release_date?.[firstGroupId];
    const parsedNum = parseFloat(num);
    return {
      name: `${num} - ${dto.title}`,
      url: `${series.slug}/${num}`,
      chapterNumber: Number.isNaN(parsedNum) ? undefined : parsedNum,
      scanlator: series.groups[firstGroupId] ?? firstGroupId,
      dateUpload: releaseDate !== undefined ? releaseDate * 1000 : undefined,
    };
  }

  private pageUrl(slug: string, folder: string, filename: string, groupId: string): string {
    return `${this.baseUrl}/media/manga/${slug}/chapters/${folder}/${groupId}/${filename}`;
  }

  override async getPopular(): Promise<SearchResult> {
    return this.parseMangaList(await this.fetchAllSeries());
  }

  override async getLatest(): Promise<SearchResult> {
    const payload = await this.fetchAllSeries();
    const sorted = Object.entries(payload).sort(
      ([, a], [, b]) => (b.last_updated ?? 0) - (a.last_updated ?? 0),
    );
    const mangas = sorted.map(([title, series]) => this.seriesDtoToManga(series, title));
    return this.filterMangas({ mangas, hasNextPage: false });
  }

  override async getSearch(query: string): Promise<SearchResult> {
    const payload = await this.fetchAllSeries();
    if (query.startsWith(SLUG_PREFIX)) {
      const slug = query.substring(SLUG_PREFIX.length);
      const filtered = Object.fromEntries(
        Object.entries(payload).filter(([, series]) => series.slug === slug),
      );
      return this.parseMangaList(filtered);
    }
    const filtered = Object.fromEntries(
      Object.entries(payload).filter(([title]) =>
        title.toLowerCase().includes(query.toLowerCase()),
      ),
    );
    return this.parseMangaList(filtered);
  }

  override async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const series = await this.fetchSeries(this.extractSlug(mangaUrl));
    return this.seriesDetailsToManga(series);
  }

  protected mangaReaderUrl(slug: string): string {
    return `${this.baseUrl}/reader/series/${slug}/`;
  }

  protected chapterReaderUrl(chapterUrl: string): string {
    return `${this.baseUrl}/read/manga/${chapterUrl.replace(/\./g, '-')}/1/`;
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.extractSlug(mangaUrl);
    const series = await this.fetchSeries(slug);
    return this.parseChapterList(series, slug);
  }

  override async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = chapterUrl.split('/')[0];
    const series = await this.fetchSeries(slug);
    const chapterNum = chapterUrl.split('/')[1] ?? '';
    const dto = series.chapters[chapterNum];
    if (!dto) return [];
    const groupIds = Object.keys(dto.groups);
    const sort = dto.preferred_sort ?? series.preferred_sort ?? null;
    let groupId: string;
    if (sort !== null) {
      groupId = this.getBestScanlator(groupIds, sort);
    } else if (groupIds.includes(DEFAULT_SCANLATOR_ID)) {
      groupId = DEFAULT_SCANLATOR_ID;
    } else {
      groupId = groupIds[0];
    }
    const filenames = dto.groups[groupId] ?? [];
    return filenames.map((filename, index) => ({
      index,
      imageUrl: this.pageUrl(series.slug, dto.folder, filename, groupId),
    }));
  }
}
