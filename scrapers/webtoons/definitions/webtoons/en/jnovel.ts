import { BaseScraper } from '../../../engine/base';
import { extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json } from '../../../engine/nextjs';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface CoverDto {
  coverUrl?: string | null;
}

interface SeriesItemDto {
  slug?: string;
  title?: string;
  cover?: CoverDto | null;
}

interface SeriesListDto {
  series?: SeriesItemDto[];
  nextPageToken?: string | null;
}

interface SeriesResponseDto {
  seriesList?: SeriesListDto | null;
}

interface CreatorDto {
  name?: string | null;
  role?: number | null;
}

interface VolumeInfoDto {
  creators?: CreatorDto[] | null;
  owned?: boolean | null;
}

interface TimeDto {
  seconds?: string | null;
}

interface RentalDto {
  expiresAt?: TimeDto | null;
}

interface PartDto {
  slug?: string;
  title?: string;
  launch?: TimeDto | null;
  number?: number | null;
  preview?: boolean | null;
  rental?: RentalDto | null;
}

interface VolumeDto {
  parts?: PartDto[];
  volume?: VolumeInfoDto | null;
}

interface SeriesDetailsDto {
  title?: string;
  description?: string | null;
  tags?: string[] | null;
  status?: number | null;
  banner?: { originalUrl?: string | null } | null;
}

interface SeriesDetailsResponseDto {
  series?: SeriesDetailsDto;
  volumes?: VolumeDto[];
}

function isSeriesResponse(value: Json): boolean {
  return isJsonObject(value) && isJsonObject(value.seriesList) && Array.isArray(value.seriesList.series);
}

function isDetailsResponse(value: Json): boolean {
  return isJsonObject(value) && isJsonObject(value.series) && Array.isArray(value.volumes);
}

function parseStatus(value: number | null | undefined): MangaStatus {
  switch (value) {
    case 0:
      return 1;
    case 1:
      return 0;
    case 2:
      return 3;
    default:
      return undefined;
  }
}

function enlargeCover(url: string | null | undefined): string {
  if (!url) return '';
  return url.replace(/\/img\/\d+\//, '/img/1200/');
}

function namesForRole(creators: CreatorDto[] | null | undefined, role: number): string {
  return (creators ?? [])
    .filter(creator => creator.role === role)
    .map(creator => creator.name?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

export class JnovelScraper extends BaseScraper {
  readonly name = 'J-Novel';
  readonly baseUrl = 'https://j-novel.club';
  readonly lang = 'en';

  private async fetchSeriesList(page: number, query: string): Promise<SeriesResponseDto> {
    const params = new URLSearchParams({ type: 'manga', page: String(page) });
    if (query.trim()) params.set('search', query.trim());
    const res = await this.get(`/series?${params.toString()}`, { headers: { RSC: '1' } });
    const value = extractNextJsRsc(String(res.data), isSeriesResponse);
    return isJsonObject(value) ? (value as unknown as SeriesResponseDto) : { seriesList: null };
  }

  private async fetchDetails(mangaUrl: string): Promise<SeriesDetailsResponseDto | null> {
    const res = await this.get(this.absUrl(mangaUrl), { headers: { RSC: '1' } });
    const value = extractNextJsRsc(String(res.data), isDetailsResponse);
    return isJsonObject(value) ? (value as unknown as SeriesDetailsResponseDto) : null;
  }

  private toManga(item: SeriesItemDto): Manga | null {
    const slug = item.slug?.trim();
    const title = item.title?.trim();
    if (!slug || !title) return null;
    return {
      title,
      url: `/series/${slug}`,
      thumbnailUrl: enlargeCover(item.cover?.coverUrl),
      lang: this.lang,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const dto = await this.fetchSeriesList(page, '');
    const items = dto.seriesList?.series ?? [];
    const mangas = items.map(item => this.toManga(item)).filter((manga): manga is Manga => manga !== null);
    return { mangas, hasNextPage: Boolean(dto.seriesList?.nextPageToken) };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const dto = await this.fetchSeriesList(page, query);
    const items = dto.seriesList?.series ?? [];
    const mangas = items.map(item => this.toManga(item)).filter((manga): manga is Manga => manga !== null);
    return { mangas, hasNextPage: Boolean(dto.seriesList?.nextPageToken) };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const dto = await this.fetchDetails(mangaUrl);
    if (!dto?.series) return { url: mangaUrl, lang: this.lang };
    const series = dto.series;
    const creators = dto.volumes?.[0]?.volume?.creators;
    return {
      title: series.title?.trim() || undefined,
      url: mangaUrl,
      thumbnailUrl: series.banner?.originalUrl ?? '',
      description: series.description?.trim() || undefined,
      author: namesForRole(creators, 1) || undefined,
      artist: namesForRole(creators, 4) || undefined,
      genre: (series.tags ?? []).filter(Boolean).join(', ') || undefined,
      status: parseStatus(series.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const dto = await this.fetchDetails(mangaUrl);
    if (!dto?.series) return [];
    const seriesTitle = dto.series.title?.trim() ?? '';
    const chapters: Chapter[] = [];
    for (const volume of dto.volumes ?? []) {
      const owned = volume.volume?.owned === true;
      for (const part of volume.parts ?? []) {
        const slug = part.slug?.trim();
        const rawTitle = part.title?.trim() || slug;
        if (!slug || !rawTitle) continue;
        const locked = !owned && part.preview === false && part.rental == null;
        const stripped = seriesTitle && rawTitle.startsWith(seriesTitle)
          ? rawTitle.slice(seriesTitle.length).trim()
          : rawTitle;
        chapters.push({
          name: `${locked ? '🔒 ' : ''}${stripped || rawTitle}`,
          url: `/read/${slug}`,
          chapterNumber: typeof part.number === 'number' ? part.number : undefined,
          dateUpload: part.launch?.seconds ? Number(part.launch.seconds) * 1000 : undefined,
        });
      }
    }
    return chapters.reverse();
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    // Pages are delivered as an encrypted E4P manifest behind the WebView viewer.
    // The webtoon pipeline only ingests the series URL, so page extraction is out of scope.
    return [];
  }
}

export default JnovelScraper;
