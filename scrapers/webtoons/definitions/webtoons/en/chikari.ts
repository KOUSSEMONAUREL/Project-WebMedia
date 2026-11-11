import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const PAGE_SIZE = 36;
const CHAPTERS_PAGE_SIZE = 200;

interface SeriesDto {
  slug: string;
  title: string;
  cover_url?: string | null;
}

interface SeriesListDto {
  items: SeriesDto[];
  total: number;
}

interface SeriesDetailsDto {
  slug: string;
  title: string;
  type?: string | null;
  status?: string | null;
  description?: string | null;
  year?: number | null;
  cover_url?: string | null;
  genres: Array<{ name: string }>;
  authors: Array<{ name: string; role: string }>;
  alt_titles: string[];
}

interface ChapterDto {
  number?: number | null;
  title?: string | null;
  created_at?: string | null;
  scans: Array<{ slug: string; name: string }>;
}

interface ChapterListDto {
  items: ChapterDto[];
  total: number;
}

interface PagesDto {
  pages: string[];
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status) {
    case 'releasing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    case 'cancelled':
    case 'canceled': return 2;
    default: return undefined;
  }
}

export class ChikariScraper extends BaseScraper {
  readonly name = 'Chikari';
  readonly baseUrl = 'https://chikari.moe';
  readonly lang = 'en';

  private seriesSlug(mangaUrl: string): string {
    return mangaUrl.split('/series/')[1]?.split(/[/#?]/)[0] ?? '';
  }

  private toManga(item: SeriesDto): Manga {
    return {
      title: item.title,
      url: `${this.baseUrl}/series/${item.slug}`,
      thumbnailUrl: item.cover_url || '',
      lang: this.lang,
    };
  }

  private async getSeriesPage(page: number, sort: string, query?: string): Promise<SearchResult> {
    const params = new URLSearchParams({
      sort,
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (query) params.set('q', query);
    const res = await this.get(`${this.baseUrl}/api/series?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const data = res.data as SeriesListDto;
    return {
      mangas: data.items.map(item => this.toManga(item)),
      hasNextPage: page * PAGE_SIZE < data.total,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSeriesPage(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getSeriesPage(page, 'updated');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    return this.getSeriesPage(page, 'popular', term);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.seriesSlug(mangaUrl);
    if (!slug) return { url: mangaUrl, lang: this.lang };
    const res = await this.get(`${this.baseUrl}/api/series/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = res.data as SeriesDetailsDto;
    const genres = [
      ...(data.type ? [data.type.replace(/^./, c => c.toUpperCase())] : []),
      ...data.genres.map(genre => genre.name),
    ];
    return {
      title: data.title,
      url: `${this.baseUrl}/series/${data.slug}`,
      thumbnailUrl: data.cover_url || '',
      author: data.authors.filter(author => author.role !== 'artist').map(author => author.name).join(', ') || undefined,
      artist: data.authors.filter(author => author.role === 'artist').map(author => author.name).join(', ') || undefined,
      description: data.description?.trim() || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      status: parseStatus(data.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.seriesSlug(mangaUrl);
    if (!slug) return [];
    const chapters: Chapter[] = [];
    let offset = 0;
    let total = Number.MAX_SAFE_INTEGER;
    do {
      const params = new URLSearchParams({
        order: 'desc',
        limit: String(CHAPTERS_PAGE_SIZE),
        offset: String(offset),
      });
      const res = await this.get(`${this.baseUrl}/api/series/${encodeURIComponent(slug)}/chapters?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const data = res.data as ChapterListDto;
      total = data.total;
      for (const item of data.items) {
        const token = item.number === null || item.number === undefined
          ? 'oneshot'
          : String(item.number).replace(/\.0$/, '');
        const baseName = item.number === null || item.number === undefined ? 'Oneshot' : `Chapter ${token}`;
        const name = item.title?.trim() ? `${baseName}: ${item.title.trim()}` : baseName;
        const targets = item.scans.length > 0 ? item.scans : [null];
        for (const scan of targets) {
          const suffix = scan ? `?scan=${encodeURIComponent(scan.slug)}` : '';
          chapters.push({
            name,
            url: `${this.baseUrl}/series/${slug}/${token}${suffix}`,
            chapterNumber: item.number ?? undefined,
            scanlator: scan?.name,
            dateUpload: item.created_at ? Date.parse(item.created_at) || undefined : undefined,
          });
        }
      }
      offset += data.items.length;
      if (data.items.length === 0) break;
    } while (offset < total);
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parsed = new URL(this.absUrl(chapterUrl));
    const segments = parsed.pathname.split('/').filter(Boolean);
    const slug = segments[1] ?? '';
    const number = segments[2] ?? '';
    if (!slug || !number) return [];
    const params = new URLSearchParams();
    const scan = parsed.searchParams.get('scan');
    if (scan) params.set('scan', scan);
    const query = params.toString();
    const res = await this.get(
      `${this.baseUrl}/api/series/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(number)}${query ? `?${query}` : ''}`,
      { headers: { Accept: 'application/json' } },
    );
    const data = res.data as PagesDto;
    return data.pages.map((imageUrl, index) => ({ index, imageUrl }));
  }
}

export default ChikariScraper;
