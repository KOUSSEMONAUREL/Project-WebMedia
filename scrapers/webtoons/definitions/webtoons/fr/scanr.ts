import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `fr/scanr` (ScanR.kt + ScanRDto.kt).
 *
 * TeamScanR has no site backend: the whole catalogue is a set of static JSON
 * files on `cdn.teamscanr.fr`, listed by `index.json` (slug -> filename).
 *
 * `latest` is not supported upstream either (`supportsLatest = false`): the
 * index carries no ordering information.
 *
 * Chapter pages go through the cubari.moe proxy, which is what upstream does.
 */

const CDN_URL = 'https://cdn.teamscanr.fr';
const CUBARI_URL = 'https://cubari.moe';
const AGE_PREFIX = '[+18] ';

interface ChapterDto {
  title: string;
  volume: string;
  last_updated: string;
  groups: Record<string, string>;
}

interface SerieDto {
  slug: string;
  title: string;
  description: string;
  artist: string;
  author: string;
  cover: string;
  os?: boolean;
  chapters: Record<string, ChapterDto>;
  completed?: boolean;
  konami?: boolean;
}

export class ScanRScraper extends BaseScraper {
  readonly name = 'ScanR';
  readonly baseUrl = 'https://teamscanr.fr';
  readonly lang = 'fr';

  private index: Map<string, string> | null = null;

  async getPopular(page: number = 1): Promise<SearchResult> {
    // The index is small and has no pagination upstream: page 1 is the whole
    // catalogue, and asking for more would loop forever.
    if (page > 1) return { mangas: [], hasNextPage: false };
    const index = await this.fetchIndex();
    const mangas: Manga[] = [];
    for (const slug of index.keys()) {
      const details = await this.fetchSerie(slug);
      if (details) mangas.push(this.toManga(details));
    }
    return { mangas, hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error('getLatest is not supported by ScanR');
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const term = query.trim().toLowerCase();
    if (!term) return this.getPopular(1);
    const index = await this.fetchIndex();
    const mangas: Manga[] = [];
    for (const slug of index.keys()) {
      // Search on the title alone, the way upstream's keyword filter behaves:
      // the static index holds slugs only, not display titles.
      if (!slug.toLowerCase().includes(term)) continue;
      const details = await this.fetchSerie(slug);
      if (details) mangas.push(this.toManga(details));
    }
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFromUrl(mangaUrl);
    const details = await this.fetchSerie(slug);
    if (!details) return { url: mangaUrl, lang: this.lang };
    return { ...this.toManga(details), description: details.description, author: details.author, artist: details.artist, status: this.toStatus(details) };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    const details = await this.fetchSerie(slug);
    if (!details) return [];
    const chapters: Chapter[] = [];
    for (const [number, dto] of Object.entries(details.chapters)) {
      const title = dto.title?.trim() ?? '';
      const volume = dto.volume?.trim() ?? '';
      // One-shots collapse the volume/chapter shape upstream.
      const name = details.os
        ? title
          ? `One Shot - ${title}`
          : 'One Shot'
        : `${volume ? `Vol. ${volume} ` : ''}Ch. ${number}${title ? ` - ${title}` : ''}`;
      chapters.push({
        name,
        url: `/${details.slug}/${number.replace(/\./g, '-')}`,
        chapterNumber: this.toChapterNumber(number),
        scanlator: Object.keys(dto.groups ?? {})[0],
        dateUpload: Number(dto.last_updated) * 1000 || undefined,
      });
    }
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const segments = chapterUrl.split('/').filter(Boolean);
    const slug = segments[0];
    const chapterNumber = (segments[1] ?? '').replace(/-/g, '.');
    const index = await this.fetchIndex();
    const details = await this.fetchSerieByFilename(index.get(slug) ?? '');
    const chapter = details?.chapters?.[chapterNumber];
    const proxyPath = chapter ? Object.values(chapter.groups ?? {})[0] : undefined;
    if (!proxyPath) return [];
    const res = await this.get(`${CUBARI_URL}${proxyPath}`);
    const images = (res.data as string[]) ?? [];
    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }

  private toManga(dto: SerieDto): Manga {
    return {
      title: `${dto.konami ? AGE_PREFIX : ''}${dto.title}`,
      url: `/${dto.slug}`,
      thumbnailUrl: dto.cover ?? '',
      lang: this.lang,
      status: this.toStatus(dto),
    };
  }

  private toStatus(dto: SerieDto): Manga['status'] {
    return dto.os || dto.completed ? 0 : 1;
  }

  private slugFromUrl(mangaUrl: string): string {
    return mangaUrl.split('/').filter(Boolean)[0] ?? '';
  }

  private async fetchIndex(): Promise<Map<string, string>> {
    if (!this.index) {
      const res = await this.get(`${CDN_URL}/index.json`);
      // axios hands back a plain object, not a Map.
      this.index = new Map(Object.entries((res.data ?? {}) as Record<string, string>));
    }
    return this.index ?? new Map();
  }

  private async fetchSerie(slug: string): Promise<SerieDto | null> {
    const index = await this.fetchIndex();
    return this.fetchSerieByFilename(index.get(slug) ?? '');
  }

  private async fetchSerieByFilename(filename: string): Promise<SerieDto | null> {
    if (!filename) return null;
    try {
      const res = await this.get(`${CDN_URL}/${filename}`);
      return res.data as SerieDto;
    } catch {
      return null;
    }
  }

  /** Faithful to upstream `toFloatOrNull() ?: -1f`: the whole string must parse. */
  private toChapterNumber(label: string): number {
    const trimmed = label.trim();
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return -1;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? -1 : parsed;
  }
}