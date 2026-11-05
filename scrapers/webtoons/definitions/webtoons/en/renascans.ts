import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface MangaDto {
  title?: string;
  slug?: string;
  cover?: string | null;
}

interface ChapterDto {
  id?: number;
  title?: string | null;
  chapter_number?: number;
  is_locked?: boolean;
  created_at?: string | null;
}

interface MangaDetailsDto extends MangaDto {
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  type?: string | null;
  genres?: string[];
  alt_titles?: string | null;
  release_year?: number | null;
  chapters?: ChapterDto[];
}

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    case 'cancelled':
    case 'canceled':
    case 'dropped': return 2;
    default: return 3;
  }
}

function uploadPath(path: string): string {
  if (path.startsWith('http') || path.startsWith('/')) return path;
  return `/uploads/${path}`;
}

function slugFrom(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url.split('#')[0];
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[1] ?? '';
  } catch {
    return url.split('#')[0];
  }
}

export class RenascansScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor() {
    super();
    this.name = 'Renascans';
    this.baseUrl = 'https://renascans.net';
    this.lang = 'en';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchManga(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchManga(page, 'newest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.searchManga(page, 'popular', query);
  }

  private async searchManga(page: number, sort: string, query?: string): Promise<SearchResult> {
    const offset = (page - 1) * 24;
    const params = new URLSearchParams({
      limit: '24',
      offset: String(offset),
      sort,
    });
    if (query) params.set('q', query.trim());
    const res = await this.get(`${this.baseUrl}/api/v1/manga?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const data = Array.isArray(res.data) ? res.data as MangaDto[] : [];
    const total = Number.parseInt(String(res.headers['x-total-count'] ?? '0'), 10);
    return {
      mangas: data.map(dto => this.mangaToManga(dto)),
      hasNextPage: offset + data.length < total,
    };
  }

  private mangaToManga(dto: MangaDto): Manga {
    return {
      title: dto.title ?? '',
      url: `${this.baseUrl}/manga/${dto.slug ?? ''}`,
      thumbnailUrl: this.coverUrl(dto.cover),
      lang: this.lang,
    };
  }

  private coverUrl(cover: string | null | undefined): string {
    if (!cover) return '';
    const absolute = this.absUrl(uploadPath(cover));
    try {
      const url = new URL(absolute);
      if (url.host !== 'images.weserv.nl') return url.toString();
      const origin = url.searchParams.get('url');
      if (!origin) return url.toString();
      return origin.startsWith('http') ? origin : `https://${origin}`;
    } catch {
      return absolute;
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const dto = await this.fetchDetails(slugFrom(mangaUrl));
    if (!dto) return {};
    const genres = [
      dto.type ? dto.type.charAt(0).toUpperCase() + dto.type.slice(1) : '',
      ...(dto.genres ?? []),
    ].filter(Boolean);
    const altTitles = (dto.alt_titles ?? '').split('|')
      .map(value => value.trim())
      .filter(value => value && value.toLowerCase() !== dto.title?.toLowerCase());
    const html = dto.description ? this.$(dto.description).text().trim() : '';
    return {
      title: dto.title ?? '',
      url: mangaUrl,
      thumbnailUrl: this.coverUrl(dto.cover),
      lang: this.lang,
      author: dto.author?.trim() || undefined,
      artist: dto.artist?.trim() || undefined,
      status: parseStatus(dto.status),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: [
        dto.release_year ? `Released: ${dto.release_year}` : '',
        html,
        altTitles.length > 0 ? `Alternative titles: ${altTitles.join(', ')}` : '',
      ].filter(Boolean).join('\n\n') || undefined,
    };
  }

  private async fetchDetails(slug: string): Promise<MangaDetailsDto | null> {
    if (!slug) return null;
    const res = await this.get(`${this.baseUrl}/api/v1/manga/${slug}`, {
      headers: { Accept: 'application/json' },
    });
    return res.data as MangaDetailsDto;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = slugFrom(mangaUrl);
    const dto = await this.fetchDetails(slug);
    if (!dto) return [];
    return (dto.chapters ?? [])
      .filter(chapter => !chapter.is_locked)
      .sort((a, b) => (b.chapter_number ?? 0) - (a.chapter_number ?? 0))
      .map(chapter => this.chapterToChapter(chapter, slug));
  }

  private chapterToChapter(dto: ChapterDto, slug: string): Chapter {
    const number = dto.chapter_number ?? 0;
    const label = String(number).replace(/\.0$/, '');
    const date = dto.created_at ? new Date(dto.created_at).getTime() : NaN;
    return {
      name: `Chapter ${label}${dto.title && dto.title !== `Chapter ${label}` ? `: ${dto.title}` : ''}`,
      url: `${this.baseUrl}/manga/${slug}/chapter-${label}#chapterId=${dto.id ?? ''}`,
      chapterNumber: number,
      dateUpload: Number.isFinite(date) ? date : undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = await this.resolveChapterId(chapterUrl);
    if (!chapterId) throw new Error('Renascans: refresh the chapter list');
    const res = await this.get(`${this.baseUrl}/api/v1/chapters/${chapterId}`, {
      headers: { Accept: 'application/json' },
    });
    const content = (res.data as { content?: string[] }).content ?? [];
    if (content.length === 0) throw new Error('Renascans: log in and unlock this chapter on the site');
    return content.map((path, index) => ({
      index,
      imageUrl: this.absUrl(uploadPath(path)),
    }));
  }

  private async resolveChapterId(chapterUrl: string): Promise<string | null> {
    const fragment = /#chapterId=([^&]+)/.exec(chapterUrl);
    if (fragment) return fragment[1];
    const parsed = new URL(chapterUrl, this.baseUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const slug = segments[1];
    const number = Number.parseFloat(segments[2]?.replace(/^chapter-/, '') ?? '');
    if (!slug || !Number.isFinite(number)) return null;
    const dto = await this.fetchDetails(slug);
    const chapter = dto?.chapters?.find(item => item.chapter_number === number);
    return chapter?.id !== undefined ? String(chapter.id) : null;
  }
}
