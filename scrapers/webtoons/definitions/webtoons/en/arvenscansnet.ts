import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.arvenscans.net';

interface MetaDto {
  current_page: number;
  total_pages: number;
}

interface PagedDto<T> {
  data: T[];
  meta: MetaDto;
}

interface DataDto<T> {
  data: T;
}

interface GenreDto {
  slug: string;
  name_en: string;
  work_count?: number;
}

interface WorkDto {
  id: string;
  slug: string;
  title: string;
  cover_url?: string | null;
  author?: string | null;
  status?: string | null;
  description?: string | null;
  tags?: string[];
  alt_titles?: string[];
  genres?: GenreDto[] | null;
}

interface ChapterDto {
  id: string;
  chapter_number: number;
  title: string;
  coins: number;
  created_at: string;
}

interface ChapterPagesDto {
  images: string[];
}

interface WorkIdDto {
  work_id: string;
}

function parseJson<T>(value: unknown): T {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

export class ArvenScansNetScraper extends BaseScraper {
  readonly name = 'ArvenScans';
  readonly baseUrl = 'https://arvenscans.net';
  readonly lang = 'en';

  private toManga(work: WorkDto, detailsGenres?: GenreDto[]): Manga {
    const genres = (detailsGenres ?? work.genres ?? []).map((g) => g.name_en);
    const allGenres = [...genres, ...(work.tags ?? [])].filter((g, i, arr) => g && arr.indexOf(g) === i);
    const altNames = (work.alt_titles ?? []).filter((t) => t.trim().length > 0);
    const parts: string[] = [];
    if (work.description) parts.push(work.description.replace(/\[/g, '\\[').replace(/\]/g, '\\]'));
    if (altNames.length > 0) {
      if (parts.length > 0) parts.push('');
      parts.push(`Alternative titles: ${altNames.join(' · ')}`);
    }
    const status = work.status?.toLowerCase();
    return {
      title: work.title,
      url: `/series/${work.slug}`,
      thumbnailUrl: work.cover_url ? `${API_URL}${work.cover_url}` : '',
      author: work.author?.trim() || undefined,
      description: parts.join('\n').trim() || undefined,
      genre: allGenres.length > 0 ? allGenres.join(', ') : undefined,
      status: status === 'ongoing' ? 1 : status === 'completed' ? 0 : status === 'hiatus' ? 3 : undefined,
      lang: this.lang,
    };
  }

  private async resolveWorkId(mangaUrl: string): Promise<string> {
    const trimmed = mangaUrl.split('?')[0];
    const parts = trimmed.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? trimmed;
    if (/^[0-9a-f-]{30,}$/i.test(last)) return last;
    const slug = last;
    const res = await this.get(`${API_URL}/resolve/work/${encodeURIComponent(slug)}`);
    const data = parseJson<WorkIdDto>(res.data);
    return data.work_id;
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${API_URL}/works/most-read?limit=20`);
    const works = parseJson<DataDto<WorkDto[]>>(res.data).data;
    return { mangas: works.map((w) => this.toManga(w)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${API_URL}/works?sort=updated&page=${page}&limit=24`);
    const data = parseJson<PagedDto<WorkDto>>(res.data);
    return { mangas: data.data.map((w) => this.toManga(w)), hasNextPage: data.meta.current_page < data.meta.total_pages };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${API_URL}/works`);
    if (query.trim()) url.searchParams.set('search', query.trim());
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '24');
    const res = await this.get(url.toString());
    const data = parseJson<PagedDto<WorkDto>>(res.data);
    return { mangas: data.data.map((w) => this.toManga(w)), hasNextPage: data.meta.current_page < data.meta.total_pages };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const workId = await this.resolveWorkId(mangaUrl);
    const [workRes, genresRes] = await Promise.all([
      this.get(`${API_URL}/works/${workId}`),
      this.get(`${API_URL}/works/${workId}/genres`),
    ]);
    const work = parseJson<WorkDto>(workRes.data);
    const genres = parseJson<DataDto<GenreDto[]>>(genresRes.data).data;
    const m = this.toManga(work, genres);
    return { ...m, url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const workId = await this.resolveWorkId(mangaUrl);
    const firstRes = await this.get(`${API_URL}/works/${workId}/chapters?page=1&limit=100&order=desc`);
    const first = parseJson<PagedDto<ChapterDto>>(firstRes.data);
    const pages = Array.from({ length: first.meta.total_pages - 1 }, (_, i) => i + 2);
    const rest = await Promise.all(pages.map(async (p) => {
      const r = await this.get(`${API_URL}/works/${workId}/chapters?page=${p}&limit=100&order=desc`);
      return parseJson<PagedDto<ChapterDto>>(r.data).data;
    }));
    const all = [first.data, ...rest].flat().filter((c) => c.coins === 0);
    return all.map((c) => {
      const numStr = String(c.chapter_number).replace(/\.0$/, '');
      return {
        name: `Chapter ${numStr}${c.title.trim() ? ` — ${c.title.trim()}` : ''}`,
        url: c.id,
        chapterNumber: c.chapter_number,
        dateUpload: Date.parse(c.created_at) || undefined,
      } as Chapter;
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${API_URL}/chapters/${chapterUrl}`);
    const data = parseJson<ChapterPagesDto>(res.data);
    return (data.images ?? []).map((path, index) => ({
      index,
      imageUrl: `${API_URL}${path}`,
    }));
  }
}

export default ArvenScansNetScraper;
