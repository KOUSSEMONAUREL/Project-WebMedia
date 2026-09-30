import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

// Transcompilation of keiyoushi src/en/kodansha (Kodansha.kt + Dto.kt +
// Filters.kt) after the Azuki API migration. Old endpoints
// (api.<domain>/discover/v2, /search/V3, token auth) are gone; the source now
// reads production.api.azuki.co with an organization key.
//
// Two distinct image hosts, which is the trap on this source:
//   - production.image.azuki.co         covers, plain bytes
//   - production.image-content.azuki.co chapter pages, each byte XOR 174
//     (upstream ImageInterceptor, which has no TypeScript counterpart here)
//
// That has NO impact in this project: this scraper only returns URLs, and
// nothing in the pipeline ever downloads the bytes of a chapter page. Covers
// come from the .image. host and are plain WebP. If a webtoon reader is ever
// built, page bytes will need the XOR decode at that point, not here.

const API_URL = 'https://production.api.azuki.co';
const ORGANIZATION_KEY = 'fff36c1f-9b3d-418e-b3a9-d2a537ddac06';
const PAGE_SIZE = 24;

// Faithful port of upstream `label.toFloatOrNull() ?: -1f`. Kotlin's
// toFloatOrNull requires the WHOLE string to be numeric, so "4b" is rejected
// (-> -1f) while "0" is kept (-> 0f). Number() and parseFloat() would both
// disagree with upstream here.
function chapterNumberFromLabel(label: string | null | undefined): number {
  const trimmed = (label ?? '').trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return -1;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? -1 : parsed;
}

interface NameDto {
  name: string;
}

interface ImageSizeDto {
  url: string;
  width: number;
}

interface ImageDto {
  webp: ImageSizeDto[];
}

interface SeriesDto {
  uuid: string;
  slug: string;
  name: string;
  short_description?: string | null;
  is_complete?: boolean | null;
  image?: ImageDto | null;
  tags?: string[] | null;
  creators?: NameDto[] | null;
  credits?: string | null;
  alt_titles?: NameDto[] | null;
}

interface SeriesListDto {
  total_count: string;
  mangas: SeriesDto[];
}

interface VolumeDto {
  uuid: string;
  label: string;
}

interface VolumeListDto {
  volumes: VolumeDto[];
}

interface ChapterDto {
  uuid: string;
  label: string;
  title?: string | null;
  volume_uuid?: string | null;
  release_date?: string | null;
  free_published_date?: string | null;
  free_unpublished_date?: string | null;
  is_upcoming?: boolean | null;
}

interface ChapterListDto {
  chapters: ChapterDto[];
}

interface PageDto {
  image: ImageDto;
}

interface PageListDto {
  data: { pages: PageDto[] };
}

function maxWidthUrl(image: ImageDto | null | undefined): string {
  if (!image || !Array.isArray(image.webp) || image.webp.length === 0) return '';
  let best = image.webp[0];
  for (const size of image.webp) {
    if (size.width > best.width) best = size;
  }
  return best.url;
}

function parseInstant(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function isChapterFree(dto: ChapterDto, now: number): boolean {
  const start = parseInstant(dto.free_published_date);
  const end = parseInstant(dto.free_unpublished_date);
  return start >= 1 && start <= now && (end === 0 || end > now);
}

function chapterDisplayName(dto: ChapterDto, volume: string | null, now: number): string {
  let name = '';
  if (!isChapterFree(dto, now)) name += '🔒 ';
  if (volume !== null) name += `Vol. ${volume} `;
  name += `Ch. ${dto.label}`;
  if (dto.title && dto.title.trim()) name += ` - ${dto.title.trim()}`;
  if (dto.is_upcoming === true) name += ' [Upcoming]';
  return name;
}

export class KodanshaScraper extends BaseScraper {
  readonly name = 'Kodansha';
  readonly baseUrl = 'https://kodansha.us';
  readonly lang = 'en';

  private apiHeaders(): Record<string, string> {
    return { 'azuki-organization-key': ORGANIZATION_KEY };
  }

  private async fetchList(
    page: number,
    query: string,
    sort: 'popular' | 'recent_series' | 'alphabetical',
  ): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('search_string', query.trim());
    params.set('sort', sort);
    params.set('series_types', 'comic');
    params.set('format', 'digital');
    params.set('count', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    const res = await this.get(`${API_URL}/mangas/v1?${params.toString()}`, {
      headers: this.apiHeaders(),
    });
    const body = res.data as SeriesListDto;
    const total = Number(body.total_count);
    return {
      mangas: (body.mangas ?? []).map((dto) => this.toManga(dto)),
      hasNextPage: Number.isFinite(total) ? page * PAGE_SIZE < total : false,
    };
  }

  private toManga(dto: SeriesDto): Manga {
    return {
      title: dto.name,
      url: `/series/${dto.slug}`,
      thumbnailUrl: maxWidthUrl(dto.image),
      lang: this.lang,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchList(page, '', 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.fetchList(page, '', 'recent_series');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const slug = this.slugFromUrl(query.trim());
    if (slug) {
      const details = await this.getMangaDetails(`/series/${slug}`);
      if (details.title) {
        return {
          mangas: [
            {
              title: details.title,
              url: `/series/${slug}`,
              thumbnailUrl: details.thumbnailUrl ?? '',
              lang: this.lang,
            },
          ],
          hasNextPage: false,
        };
      }
    }
    return this.fetchList(page, query, 'popular');
  }

  private slugFromUrl(value: string): string | null {
    if (!/^https?:\/\//i.test(value)) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.host !== 'kodansha.us' && url.host !== 'www.kodansha.us') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && segments[0] === 'series') return segments[1];
    if (segments.length >= 3 && segments[0] === 'reader' && segments[1] === 'series') return segments[2];
    return null;
  }

  private async fetchSeriesBySlug(slug: string): Promise<SeriesDto> {
    const res = await this.get(`${API_URL}/manga/slug/${encodeURIComponent(slug)}/v0`, {
      headers: this.apiHeaders(),
    });
    return res.data as SeriesDto;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    // Accepts "/series/<slug>", "/reader/series/<slug>" and a bare slug. A
    // trailing segment pop would read a full reader URL ending in
    // "/episode/<n>" as the slug, so reuse the search-side parser first.
    const slug =
      this.slugFromUrl(mangaUrl) ?? mangaUrl.split('/').filter(Boolean).pop() ?? '';
    if (!slug) return { url: mangaUrl, lang: this.lang };
    const dto = await this.fetchSeriesBySlug(slug);
    const descriptionParts: string[] = [];
    if (dto.short_description) descriptionParts.push(dto.short_description);
    if (dto.credits && dto.credits.trim()) descriptionParts.push(dto.credits.trim());
    if (dto.alt_titles && dto.alt_titles.length > 0) {
      descriptionParts.push(`Alternative Titles:\n${dto.alt_titles.map((t) => t.name).join('\n')}`);
    }
    return {
      title: dto.name,
      url: `/series/${dto.slug}`,
      thumbnailUrl: maxWidthUrl(dto.image),
      description: descriptionParts.join('\n\n').trim() || undefined,
      author: (dto.creators ?? []).map((c) => c.name).join(', ') || undefined,
      genre: (dto.tags ?? []).join(', ') || undefined,
      status: dto.is_complete === true ? 0 : 1,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? '';
    if (!slug) return [];
    const series = await this.fetchSeriesBySlug(slug);
    const volumesRes = await this.get(`${API_URL}/mangas/${series.uuid}/volumes/v0`, {
      headers: this.apiHeaders(),
    });
    const volumeLabels = new Map<string, string>();
    for (const volume of ((volumesRes.data as VolumeListDto).volumes ?? [])) {
      volumeLabels.set(volume.uuid, volume.label);
    }
    const params = new URLSearchParams({ order: 'ascending', count: '1000' });
    const chaptersRes = await this.get(
      `${API_URL}/mangas/${series.uuid}/chapters/v4?${params.toString()}`,
      { headers: this.apiHeaders() },
    );
    const now = Date.now();
    const chapters = ((chaptersRes.data as ChapterListDto).chapters ?? []).map((dto) => {
      const volume = dto.volume_uuid ? (volumeLabels.get(dto.volume_uuid) ?? null) : null;
      return {
        name: chapterDisplayName(dto, volume, now),
        url: `/chapters/${dto.uuid}`,
        chapterNumber: chapterNumberFromLabel(dto.label),
        dateUpload: parseInstant(dto.release_date) || undefined,
      } as Chapter;
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const uuid = chapterUrl.split('/').filter(Boolean).pop() ?? '';
    if (!uuid) return [];
    let res;
    try {
      // No validateStatus override: a non-2xx must throw instead of silently
      // yielding an empty page list (upstream opts out of this explicitly,
      // but then inspects the status by hand).
      res = await this.get(`${API_URL}/chapters/${encodeURIComponent(uuid)}/pages/v1`, {
        headers: this.apiHeaders(),
      });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        throw new Error('This chapter must be purchased on Kodansha to read');
      }
      throw err;
    }
    const pages = ((res.data as PageListDto).data?.pages ?? []).map((page, index) => ({
      index,
      imageUrl: maxWidthUrl(page.image),
    }));
    return pages;
  }
}
