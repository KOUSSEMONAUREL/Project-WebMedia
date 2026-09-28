import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

// Transcompilation of keiyoushi src/en/flamecomics (FlameComics.kt + Dto.kt).
// Next.js Pages Router site: JSON data routes under /_next/data/<buildId>/,
// images on https://cdn.flamecomics.xyz/uploads/images/series/<id>/...

const CDN_BASE = 'https://cdn.flamecomics.xyz/uploads/images/series';
const THUMBNAIL_FRAGMENT = 'thumbnails';

interface SeriesDto {
  title?: string;
  altTitles?: string[] | null;
  description?: string | null;
  cover?: string;
  type?: string | null;
  tags?: string[] | null;
  categories?: string[] | null;
  author?: string[] | null;
  artist?: string[] | null;
  status?: string | null;
  series_id?: number | null;
  last_edit?: number | null;
  views?: number | null;
  likes?: number | null;
  popularityRank?: number | null;
}

interface ChapterDto {
  chapter?: number | string | null;
  title?: string | null;
  chapter_title?: string | null;
  release_date?: number | null;
  series_id?: number | null;
  token?: string | null;
}

interface ChapterImagesDto {
  release_date?: number | null;
  series_id?: number | null;
  token?: string | null;
  images?: Record<string, { name?: string } | string> | Array<{ name?: string } | string> | null;
}

function toJson(data: unknown): unknown {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

function seriesPopularity(s: SeriesDto): number {
  if (typeof s.views === 'number') return s.views;
  if (typeof s.likes === 'number') return s.likes;
  if (typeof s.popularityRank === 'number' && s.popularityRank > 0) return 1 / s.popularityRank;
  return 0;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, '');
}

function chapterNumberOf(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isNaN(num) ? undefined : num;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export class FlameComicsScraper extends BaseScraper {
  readonly name = 'Flame Comics';
  readonly baseUrl = 'https://flamecomics.xyz';
  readonly lang = 'en';

  private buildId: string | null = null;

  private async fetchBuildId(): Promise<string> {
    if (this.buildId) return this.buildId;
    const res = await this.get(this.baseUrl);
    const html = String(res.data);
    const match = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(html);
    if (!match || !match[1]) throw new Error('Failed to find __NEXT_DATA__');
    const root = JSON.parse(match[1]) as { buildId?: string };
    if (!root.buildId) throw new Error('Failed to find buildId');
    this.buildId = root.buildId;
    return root.buildId;
  }

  private async dataUrl(path: string, query?: Record<string, string>): Promise<string> {
    const buildId = await this.fetchBuildId();
    const url = new URL(`${this.baseUrl}/_next/data/${buildId}/${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  private imagesUrl(seriesId: number, name: string, stamp?: number | null, fragment = true): string {
    const url = new URL(`${CDN_BASE}/${seriesId}/${name}`);
    if (stamp !== null && stamp !== undefined) url.searchParams.set(String(stamp), '');
    if (fragment) url.hash = THUMBNAIL_FRAGMENT;
    return url.toString();
  }

  private toManga(s: SeriesDto): Manga | null {
    if (s.series_id === null || s.series_id === undefined) return null;
    const id = s.series_id;
    const thumbnailUrl = s.cover
      ? this.imagesUrl(id, s.cover ?? '', s.last_edit ?? null)
      : '';
    return {
      title: s.title ?? '',
      url: `/series/${id}`,
      thumbnailUrl,
      lang: this.lang,
    };
  }

  private async fetchBrowseSeries(): Promise<SeriesDto[]> {
    const res = await this.get(await this.dataUrl('browse.json'));
    const data = toJson(res.data) as { pageProps?: { series?: SeriesDto[] } };
    return data?.pageProps?.series ?? [];
  }

  async getPopular(page = 1): Promise<SearchResult> {
    void page;
    const series = (await this.fetchBrowseSeries())
      .filter(s => s.series_id !== null && s.series_id !== undefined)
      .sort((a, b) => seriesPopularity(b) - seriesPopularity(a));
    return {
      mangas: series.map(s => this.toManga(s)).filter((m): m is Manga => m !== null),
      hasNextPage: false,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    void page;
    const res = await this.get(await this.dataUrl('index.json'));
    const data = toJson(res.data) as {
      pageProps?: {
        latestEntries?: { blocks?: Array<{ series?: SeriesDto[] }> };
        popularEntries?: { blocks?: Array<{ series?: SeriesDto[] }> };
      };
    };
    const blocks = data?.pageProps?.latestEntries?.blocks
      ?? data?.pageProps?.popularEntries?.blocks
      ?? [];
    const series = (blocks[0]?.series ?? []);
    return {
      mangas: series.map(s => this.toManga(s)).filter((m): m is Manga => m !== null),
      hasNextPage: false,
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    void page;
    const normalized = normalizeTitle(query);
    const series = (await this.fetchBrowseSeries()).filter(s => {
      const titles = [s.title ?? '', ...(s.altTitles ?? [])];
      return titles.some(t => normalizeTitle(t).includes(normalized));
    });
    const itemsPerPage = 20;
    void itemsPerPage;
    return {
      mangas: series.map(s => this.toManga(s)).filter((m): m is Manga => m !== null),
      hasNextPage: false,
    };
  }

  private seriesIdFromUrl(mangaUrl: string): string {
    return this.absUrl(mangaUrl).split('?')[0].split('/').filter(Boolean).pop() ?? '';
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const seriesId = this.seriesIdFromUrl(mangaUrl);
    const res = await this.get(await this.dataUrl(`series/${seriesId}.json`, { id: seriesId }));
    const data = toJson(res.data) as { pageProps?: { series?: SeriesDto } };
    const s = data?.pageProps?.series;
    if (!s) throw new Error('Series not found');
    const base = this.toManga({ ...s, series_id: Number(seriesId) });
    const synopsis = stripHtml(s.description ?? '');
    const altNames = (s.altTitles ?? []).map(t => t.trim()).filter(Boolean);
    const descriptionParts: string[] = [];
    if (synopsis) descriptionParts.push(synopsis);
    if (altNames.length > 0) {
      descriptionParts.push(`Alternative Names:\n${altNames.map(n => `- ${n}`).join('\n')}`);
    }
    const tags = s.tags ?? s.categories ?? [];
    const genre = [s.type ?? '', ...tags].filter(Boolean).join(', ') || undefined;
    const status = (s.status ?? '').toLowerCase();
    return {
      title: s.title ?? base?.title ?? '',
      url: `/series/${seriesId}`,
      thumbnailUrl: base?.thumbnailUrl ?? '',
      description: descriptionParts.join('\n\n') || undefined,
      author: (s.author ?? []).join(', ') || undefined,
      artist: (s.artist ?? []).join(', ') || undefined,
      genre,
      status: status === 'ongoing' ? 1
        : status === 'dropped' ? 2
        : status === 'hiatus' ? 3
        : status === 'completed' ? 0
        : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const seriesId = this.seriesIdFromUrl(mangaUrl);
    const res = await this.get(await this.dataUrl(`series/${seriesId}.json`, { id: seriesId }));
    const data = toJson(res.data) as { pageProps?: { chapters?: ChapterDto[] } };
    const chapters = data?.pageProps?.chapters ?? [];
    return chapters
      .filter(ch => ch.token && ch.series_id !== null && ch.series_id !== undefined)
      .map(ch => {
        const num = chapterNumberOf(ch.chapter);
        const numLabel = num !== undefined
          ? String(num).replace(/\.0$/, '')
          : String(ch.chapter ?? '');
        const title = (ch.title ?? ch.chapter_title ?? '').trim();
        return {
          name: `Chapter ${numLabel}${title ? ` - ${title}` : ''}`,
          url: `/series/${ch.series_id}/${ch.token}`,
          chapterNumber: num,
          dateUpload: ch.release_date ? ch.release_date * 1000 : undefined,
        };
      });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = this.absUrl(chapterUrl).split('?')[0].split('/').filter(Boolean);
    const token = parts.pop() ?? '';
    const seriesId = parts.pop() ?? '';
    const res = await this.get(
      await this.dataUrl(`series/${seriesId}/${token}.json`, { id: seriesId, token }),
    );
    const data = toJson(res.data) as { pageProps?: { chapter?: ChapterImagesDto } };
    const ch = data?.pageProps?.chapter;
    const images = ch?.images;
    const names: string[] = [];
    if (Array.isArray(images)) {
      for (const item of images) {
        const name = typeof item === 'string' ? item : item?.name;
        if (name) names.push(name);
      }
    } else if (images && typeof images === 'object') {
      for (const item of Object.values(images)) {
        const name = typeof item === 'string' ? item : item?.name;
        if (name) names.push(name);
      }
    }
    const sid = Number(seriesId);
    return names.map((name, index) => ({
      index,
      imageUrl: this.imagesUrl(sid, `${token}/${name}`, ch?.release_date ?? null, false),
    }));
  }
}
