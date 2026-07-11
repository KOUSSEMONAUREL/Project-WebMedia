import { BaseScraper } from '@engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '@engine/types';

interface SeriesDto {
  slug: string;
  title: string;
  cover: string;
  author: string | null;
  artist: string | null;
  description: string | null;
  rating: number | null;
  popularity_rank: number | null;
  alt_titles: string[] | null;
  status: string | null;
  genres: { name: string }[] | null;
  public_url: string;
}

interface ChapterDto {
  number: number;
  slug: string;
  title: string | null;
  published_at: string;
  is_locked: boolean;
  series_slug: string;
}

interface PageDto {
  url: string;
}

function buildDescription(dto: SeriesDto): string | undefined {
  const parts: string[] = [];
  const desc = dto.description?.replace(/<[^>]*>/g, '').trim();
  if (desc) parts.push(desc);
  if (dto.rating != null) parts.push(`Rating: ${dto.rating.toFixed(2)}`);
  if (dto.popularity_rank != null) parts.push(`Rank: #${dto.popularity_rank}`);
  if (dto.alt_titles?.length) {
    parts.push('Alternative Titles:\n' + dto.alt_titles.map(t => `- ${t}`).join('\n'));
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

const API = 'https://api.asurascans.com/api';

function unwrapAstro(v: any): any {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
    if (v[0] === 0) return unwrapAstro(v[1]);
    if (v[0] === 1) return (v[1] as any[]).map(unwrapAstro);
    if (v[0] === 2) {
      const obj: any = {};
      for (const [k, val] of Object.entries(v[1] as any)) {
        obj[k] = unwrapAstro(val);
      }
      return obj;
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj: any = {};
    for (const [k, val] of Object.entries(v)) {
      obj[k] = unwrapAstro(val);
    }
    return obj;
  }
  return v;
}

function extractProps(html: string, key: string): any {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return null;
  const re = new RegExp(`props="([^"]*${key}[^"]*)"`);
  const m = re.exec(html);
  if (!m) return null;
  try {
    const json = JSON.parse(m[1].replace(/&quot;/g, '"'));
    return unwrapAstro(json)?.[key] ?? null;
  } catch {
    return null;
  }
}

export class AsuraScansScraper extends BaseScraper {
  readonly name = 'Asura Scans';
  readonly baseUrl = 'https://asurascans.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this._fetchSeries(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this._fetchSeries(page, 'latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const offset = (page - 1) * 20;
    const res = await this.client.get(`${API}/series`, { params: { offset, limit: 20, search: query } });
    const body = res.data as any;
    const data: SeriesDto[] = body.data || [];
    const hasMore = body.meta?.has_more ?? false;
    return {
      mangas: data.map(s => ({
        title: s.title,
        url: this.absUrl(s.public_url),
        thumbnailUrl: s.cover,
        author: s.author || s.artist || undefined,
        lang: this.lang,
      })),
      hasNextPage: hasMore,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const fullSlug = mangaUrl.replace(/.*\/comics\//, '').replace(/[?#].*$/, '');
    const slug = fullSlug.replace(/-fc4c7eba$/, '');
    const res = await this.client.get(`${API}/series/${slug}`);
    const body = res.data as any;
    const series: SeriesDto = body.series || body.data?.series || body.data || body;
    const statusMap: Record<string, MangaStatus> = { ongoing: 1, completed: 2, hiatus: 3, dropped: 3, axed: 3 };
    return {
      title: series.title,
      url: mangaUrl,
      thumbnailUrl: series.cover,
      description: buildDescription(series),
      author: series.author || series.artist || undefined,
      artist: series.artist || undefined,
      genre: series.genres?.map((g: any) => g.name).join(', ') || undefined,
      status: statusMap[series.status?.toLowerCase() || ''] ?? 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const mangaSlug = mangaUrl.replace(/.*\/comics\//, '').replace(/[?#].*$/, '');
    const res = await this.client.get(mangaUrl);
    const chapters: ChapterDto[] | null = extractProps(res.data as string, 'chapters');
    if (!chapters) return [];
    return chapters.map(ch => ({
      name: `Chapter ${ch.number}${ch.title ? ` - ${ch.title}` : ''}`,
      url: this.absUrl(`/comics/${mangaSlug}/chapter/${ch.number}`),
      chapterNumber: ch.number,
      dateUpload: ch.published_at ? new Date(ch.published_at).getTime() : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.client.get(chapterUrl);
    const pages: PageDto[] | null = extractProps(res.data as string, 'pages');
    if (!pages) return [];
    return pages.map((p, i) => ({
      index: i,
      imageUrl: p.url,
    }));
  }

  private async _fetchSeries(page: number, sort: string): Promise<SearchResult> {
    const offset = (page - 1) * 20;
    const res = await this.client.get(`${API}/series`, { params: { offset, limit: 20, sort } });
    const body = res.data as any;
    const data: SeriesDto[] = body.data || [];
    const hasMore = body.meta?.has_more ?? false;
    return {
      mangas: data.map(s => ({
        title: s.title,
        url: this.absUrl(s.public_url),
        thumbnailUrl: s.cover,
        author: s.author || s.artist || undefined,
        lang: this.lang,
      })),
      hasNextPage: hasMore,
    };
  }
}
