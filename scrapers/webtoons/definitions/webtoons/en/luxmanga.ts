import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface LuxWork {
  id: string;
  title: string;
  description?: string | null;
  cover_url?: string | null;
  author?: string | null;
  status?: string | null;
}

interface WorkList {
  data: LuxWork[];
  meta?: { total_pages?: number };
}

interface WorkMetadata {
  alternative_titles?: string[];
  tags?: string[];
}

interface GenreList {
  data: Array<{ name_en: string }>;
}

interface LuxChapter {
  id: string;
  chapter_number: number;
  title?: string | null;
  coins: number;
  created_at?: string | null;
  images?: string[];
}

interface ChapterList {
  data: LuxChapter[];
  meta?: { total_pages?: number };
}

const API = 'https://api.luxmanga.org';

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    default: return undefined;
  }
}

export class LuxMangaScraper extends BaseScraper {
  readonly name = 'LuxManga';
  readonly baseUrl = 'https://luxmanga.org';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${API}/works/most-read?limit=20&page=${page}`);
    const data = res.data as { data?: LuxWork[] };
    const works = Array.isArray(data.data) ? data.data : [];
    return { mangas: works.map(w => this.toManga(w)), hasNextPage: works.length === 20 };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${API}/works/latest-updates?limit=24&page=${page}`);
    const data = res.data as { data?: LuxWork[] };
    const works = Array.isArray(data.data) ? data.data : [];
    return { mangas: works.map(w => this.toManga(w)), hasNextPage: works.length === 24 };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${API}/works`);
    url.searchParams.set('limit', '24');
    url.searchParams.set('page', String(page));
    if (query.trim()) url.searchParams.set('search', query.trim());
    const res = await this.get(url.toString());
    const data = res.data as WorkList;
    const works = Array.isArray(data.data) ? data.data : [];
    return {
      mangas: works.map(w => this.toManga(w)),
      hasNextPage: page < (data.meta?.total_pages ?? page),
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.workId(mangaUrl);
    if (!id) return {};
    const [workRes, metaRes, genreRes] = await Promise.all([
      this.get(`${API}/works/${id}`),
      this.get(`${API}/works/${id}/metadata`).catch(() => null),
      this.get(`${API}/works/${id}/genres`).catch(() => null),
    ]);
    const work = workRes.data as LuxWork;
    const metadata = metaRes ? metaRes.data as WorkMetadata : {};
    const genres = genreRes ? (genreRes.data as GenreList).data ?? [] : [];
    const altTitles = (metadata.alternative_titles ?? [])
      .filter(t => t.toLowerCase() !== work.title.toLowerCase());
    let description = work.description ?? '';
    if (altTitles.length > 0) {
      if (description) description += '\n\n';
      description += '**Also known as:**\n' + altTitles.map(t => `- ${t}`).join('\n');
    }
    return {
      title: work.title,
      thumbnailUrl: this.coverUrl(work.cover_url),
      author: work.author?.replace(/ \/ /g, ', ') || undefined,
      status: parseStatus(work.status),
      genre: [...genres.map(g => g.name_en), ...(metadata.tags ?? [])].join(', ') || undefined,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.workId(mangaUrl);
    if (!id) return [];
    const first = await this.fetchChapters(id, 1);
    const pages = first.meta?.total_pages ?? 1;
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) => this.fetchChapters(id, i + 2)),
    );
    return [first, ...rest]
      .flatMap(list => list.data)
      .filter(ch => ch.coins === 0)
      .map(ch => {
        const number = Number(ch.chapter_number);
        const label = number.toString();
        const title = ch.title?.trim();
        return {
          name: title && title.toLowerCase() !== label && title.toLowerCase() !== `chapter ${label}`
            ? `Chapter ${label} — ${title}`
            : `Chapter ${label}`,
          url: `${this.baseUrl}/reader/${ch.id}`,
          chapterNumber: number,
          dateUpload: ch.created_at ? Date.parse(ch.created_at) : undefined,
        };
      });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.split('/').filter(Boolean).pop() ?? '';
    if (!id) return [];
    const res = await this.get(`${API}/chapters/${id}`);
    const chapter = res.data as LuxChapter;
    return (chapter.images ?? []).map((path, index) => ({
      index,
      imageUrl: new URL(path, API).toString(),
    }));
  }

  private async fetchChapters(id: string, page: number): Promise<ChapterList> {
    const res = await this.get(`${API}/works/${id}/chapters?page=${page}&limit=100&order=desc`);
    const data = res.data as ChapterList;
    return { data: Array.isArray(data.data) ? data.data : [], meta: data.meta };
  }

  private toManga(work: LuxWork): Manga {
    return {
      title: work.title,
      url: `${this.baseUrl}/series/${work.id}`,
      thumbnailUrl: this.coverUrl(work.cover_url) ?? '',
      lang: this.lang,
    };
  }

  private coverUrl(cover: string | null | undefined): string | undefined {
    if (!cover) return undefined;
    return new URL(cover, API).toString();
  }

  private workId(url: string): string | undefined {
    try {
      const parts = new URL(url, this.baseUrl).pathname.split('/').filter(Boolean);
      return parts[1];
    } catch {
      return undefined;
    }
  }
}
