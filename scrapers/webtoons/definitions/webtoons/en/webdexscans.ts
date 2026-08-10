import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const SUPABASE_URL = 'https://nrqghtbdrdnoywxjkgkf.supabase.co/rest/v1';
const SUPABASE_API_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycWdodGJkcmRub3l3eGprZ2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Njg4NDEsImV4cCI6MjA5MjQ0NDg0MX0.Gnrn33_LMxFA9m_OdCpybBZ-Cjcc5rdsJlD8Y9eOICg';

interface SearchSeriesDto {
  id: string;
  title: string;
  slug: string;
  cover_url?: string | null;
}

interface GenreInfo {
  name: string;
}

interface SeriesInfo {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: GenreInfo[] | null;
}

interface ChapterInfo {
  id: string;
  title?: string | null;
  slug: string;
  chapter_number?: number | null;
  created_at?: string | null;
  is_premium?: boolean;
  free_at?: string | null;
  series?: { slug: string } | null;
}

interface PageInfo {
  image_url: string;
}

const BLOCK_TAG_REGEX = /<\/p|<\/div|<\/h[1-6]>/gi;
const TRIM_LINES_REGEX = /[ \t\r]*\n[ \t\r]*/g;
const MULTI_NEWLINE_REGEX = /\n{3,}/g;

export class WebdexscansScraper extends BaseScraper {
  readonly name = 'Webdex Scans';
  readonly baseUrl = 'https://webdexscans.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * 24;
    const data = await this.apiGet('/series', {
      select: 'id,title,slug,cover_url',
      order: 'view_count.desc',
      offset: String(offset),
      limit: '24',
    });
    return this.mangaListParse(data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * 24;
    const data = await this.apiGet('/series', {
      select: 'id,title,slug,cover_url',
      order: 'updated_at.desc',
      offset: String(offset),
      limit: '24',
    });
    return this.mangaListParse(data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const offset = (page - 1) * 24;
    const params: Record<string, string> = {
      select: 'id,title,slug,cover_url',
      order: 'updated_at.desc',
      offset: String(offset),
      limit: '24',
    };
    if (query.trim()) {
      params.title = `ilike.%${query}%`;
    }
    const data = await this.apiGet('/series', params);
    return this.mangaListParse(data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = await this.resolveSeriesId(mangaUrl);
    if (!id) return {};
    const data = await this.apiGet('/series', { id: `eq.${id}`, select: '*,genres(name)' });
    const series = (Array.isArray(data) ? (data[0] as SeriesInfo | undefined) : undefined) as SeriesInfo | undefined;
    if (!series) return {};
    return this.seriesToManga(series, mangaUrl);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = await this.resolveSeriesId(mangaUrl);
    if (!id) return [];
    const data = await this.apiGet('/chapters', {
      series_id: `eq.${id}`,
      select: 'id,chapter_number,title,slug,created_at,is_premium,free_at,series(slug)',
      order: 'chapter_number.desc',
    });
    const infos = (Array.isArray(data) ? data : []) as ChapterInfo[];
    const seriesSlug = infos[0]?.series?.slug ?? '';
    return infos
      .filter(info => !this.isPremium(info))
      .map(info => this.chapterToChapter(info, seriesSlug));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const data = await this.apiGet('/pages', {
      chapter_id: `eq.${chapterUrl}`,
      select: 'image_url,page_number',
      order: 'page_number.asc',
    });
    const pages = (Array.isArray(data) ? data : []) as PageInfo[];
    return pages.map((page, index) => ({
      index,
      imageUrl: page.image_url.startsWith('/') ? this.baseUrl + page.image_url : page.image_url,
    }));
  }

  private async apiGet(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    const res = await this.client.get(`${SUPABASE_URL}${path}?${qs}`, {
      headers: {
        apikey: SUPABASE_API_KEY,
        authorization: `Bearer ${SUPABASE_API_KEY}`,
        Accept: 'application/json',
      },
    });
    return res.data;
  }

  private mangaListParse(data: unknown): SearchResult {
    const list = (Array.isArray(data) ? data : []) as SearchSeriesDto[];
    const mangas = list.map(item => ({
      title: item.title,
      url: item.id,
      thumbnailUrl: item.cover_url ? this.absUrl(item.cover_url) : '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: mangas.length === 24 };
  }

  private seriesToManga(series: SeriesInfo, url: string): Partial<Manga> {
    const manga: Partial<Manga> = {
      title: series.title,
      url,
      thumbnailUrl: series.cover_url ? this.absUrl(series.cover_url) : '',
      lang: this.lang,
    };
    if (series.author) manga.author = series.author;
    if (series.artist) manga.artist = series.artist;
    if (series.description) {
      const cleanHtml = series.description.replace(BLOCK_TAG_REGEX, '\n');
      manga.description = this.$(cleanHtml).text()
        .replace(/\u00a0/g, ' ')
        .replace(TRIM_LINES_REGEX, '\n')
        .replace(MULTI_NEWLINE_REGEX, '\n\n')
        .trim();
    }
    switch ((series.status || '').toLowerCase()) {
      case 'ongoing': manga.status = 1; break;
      case 'completed': manga.status = 2; break;
      case 'hiatus':
      case 'cancelled': manga.status = 3; break;
    }
    if (series.genres && series.genres.length > 0) {
      manga.genre = series.genres.map(g => g.name).join(', ');
    }
    return manga;
  }

  private chapterToChapter(info: ChapterInfo, seriesSlug: string): Chapter {
    const chapterName = (info.title && info.title.trim())
      ? info.title.trim()
      : info.chapter_number != null
        ? `Chapter ${String(info.chapter_number).replace(/\.0$/, '')}`
        : 'Chapter';
    const locked = this.isPremium(info);
    const dateUpload = info.created_at ? Date.parse(info.created_at) : NaN;
    return {
      name: locked ? `🔒 ${chapterName}` : chapterName,
      url: info.id,
      chapterNumber: info.chapter_number ?? -1,
      dateUpload: isNaN(dateUpload) ? undefined : dateUpload,
    };
  }

  private isPremium(info: ChapterInfo): boolean {
    if (!info.is_premium) return false;
    if (!info.free_at) return true;
    const freeAt = Date.parse(info.free_at);
    return isNaN(freeAt) ? true : freeAt > Date.now();
  }

  private async resolveSeriesId(mangaUrl: string): Promise<string | null> {
    const url = mangaUrl.startsWith('http') ? mangaUrl : this.baseUrl + mangaUrl;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      console.error(`Failed to parse manga URL on ${this.name}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] === 'series' && segments.length >= 2) {
      const slug = decodeURIComponent(segments[1]);
      const data = await this.apiGet('/series', { slug: `eq.${slug}`, select: 'id' });
      const series = (Array.isArray(data) ? (data[0] as SearchSeriesDto | undefined) : undefined) as SearchSeriesDto | undefined;
      return series?.id ?? null;
    }
    return segments.join('/') || mangaUrl;
  }
}
