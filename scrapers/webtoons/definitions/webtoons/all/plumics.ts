import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface ProjectDto {
  id: number;
  name: string;
  cover: string | null;
  category: string;
  lang: string;
  updated_at: string | null;
  slug: string;
}

interface ProjectListDto {
  data: ProjectDto[];
  next_page_url: string | null;
}

interface UserDto {
  name: string;
}

interface ProjectDetailsDto {
  id: number;
  name: string;
  cover: string | null;
  category: string;
  lang: string;
  author_name: string | null;
  author: UserDto | null;
  user: UserDto | null;
  description: string | null;
  genre: string | null;
  status: string | null;
  chapter_mode: boolean;
  created_at: string | null;
  slug: string;
}

interface ProjectResponse {
  project: ProjectDetailsDto;
}

interface ChapterDto {
  id: number;
  number: number;
  title: string | null;
  coins: number;
  published_at: string | null;
}

interface ChapterListDto {
  data: ChapterDto[];
  total: number;
  per_page: number;
}

interface PageDto {
  id: number;
}

interface PageListDto {
  pages: PageDto[];
}

const CATEGORIES: Record<string, string> = {
  manga: 'Manga',
  comics: 'Comics',
  webtoon: 'Webtoon',
  bd: 'BD',
};

export class PlumicsScraper extends BaseScraper {
  override readonly name = 'Plumics';
  override readonly baseUrl = 'https://plumics.com';
  override readonly lang = 'en';

  private get apiUrl(): string {
    return `${this.baseUrl}/api`;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getProjects(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getProjects(page, 'recent');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim() === '') {
      return this.getProjects(page, 'popular');
    }

    const url = new URL(`${this.apiUrl}/search`);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('c', 'project');
    url.searchParams.set('page', page.toString());
    const response = await this.get(url.toString());
    const result = response.data as ProjectListDto;
    const mangas = result.data
      .filter(project => project.lang === this.lang && project.category !== 'novel')
      .map(project => this.toManga(project));
    if (mangas.length === 0) {
      const fallback = await this.getProjects(page, 'popular');
      const needle = query.trim().toLowerCase();
      const matches = fallback.mangas.filter(manga => manga.title.toLowerCase().includes(needle));
      if (matches.length > 0) {
        return { mangas: matches, hasNextPage: fallback.hasNextPage };
      }
    }
    return { mangas, hasNextPage: result.next_page_url !== null };
  }

  private async getProjects(page: number, sort: string): Promise<SearchResult> {
    const types = ['pro', 'starter'];
    const lists = await Promise.all(types.map(async type => {
      const url = new URL(`${this.apiUrl}/project/${type}`);
      url.searchParams.set(sort, '1');
      url.searchParams.set('lang', this.lang);
      url.searchParams.set('page', page.toString());
      const response = await this.get(url.toString());
      return response.data as ProjectListDto;
    }));

    const projects = lists.flatMap(list => list.data);
    if (sort === 'recent') {
      projects.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
    }
    return {
      mangas: projects.map(project => this.toManga(project)),
      hasNextPage: lists.some(list => list.next_page_url !== null),
    };
  }

  private toManga(project: ProjectDto): Manga {
    return {
      title: project.name,
      url: this.absUrl(`/${project.category}/${project.slug}`),
      thumbnailUrl: project.cover ? `${this.baseUrl}/storage/${project.cover}` : '',
      lang: this.lang,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const project = await this.getProject(this.projectIdFromUrl(mangaUrl));
    return {
      title: project.name,
      url: this.absUrl(`/${project.category}/${project.slug}`),
      thumbnailUrl: project.cover ? `${this.baseUrl}/storage/${project.cover}` : '',
      lang: this.lang,
      author: project.author_name ?? project.author?.name ?? undefined,
      description: project.description ?? undefined,
      genre: this.formatGenre(project),
      status: this.toStatus(project.status),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const project = await this.getProject(this.projectIdFromUrl(mangaUrl));
    if (!project.chapter_mode) {
      return [{
        name: 'Chapter',
        url: this.absUrl(`/reader/p/${project.id}`),
        dateUpload: this.parseDate(project.created_at),
      }];
    }

    const firstPage = await this.getChapterPage(project.id, 1);
    const lastPage = firstPage.per_page > 0 ? Math.ceil(firstPage.total / firstPage.per_page) : 1;
    const otherPages = await Promise.all(
      Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => this.getChapterPage(project.id, index + 2)),
    );
    const chapters = [firstPage, ...otherPages]
      .flatMap(result => result.data)
      .map(chapter => this.toChapter(chapter));
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const segments = new URL(this.absUrl(chapterUrl)).pathname.split('/').filter(Boolean);
    const mode = segments[1];
    const id = segments[2] || '';
    const owner = mode === 'p' ? 'project' : 'chapter';
    const response = await this.get(`${this.apiUrl}/${owner}/${id}/pages`);
    const result = response.data as PageListDto;
    return result.pages.map((page, index) => ({
      index,
      imageUrl: `${this.apiUrl}/page/${page.id}`,
    }));
  }

  private async getProject(id: string): Promise<ProjectDetailsDto> {
    const response = await this.get(`${this.apiUrl}/project/${id}`);
    return (response.data as ProjectResponse).project;
  }

  private async getChapterPage(projectId: number, page: number): Promise<ChapterListDto> {
    const response = await this.get(`${this.apiUrl}/project/${projectId}/chapters?page=${page}`);
    return response.data as ChapterListDto;
  }

  private toChapter(chapter: ChapterDto): Chapter {
    const number = chapter.number.toString().replace(/\.0$/, '');
    const name = chapter.coins > 0 ? `Locked Chapter ${number}` : `Chapter ${number}`;
    return {
      name: chapter.title?.trim() ? `${name}: ${chapter.title.trim()}` : name,
      url: this.absUrl(`/reader/c/${chapter.id}`),
      chapterNumber: chapter.number,
      dateUpload: this.parseDate(chapter.published_at),
    };
  }

  private formatGenre(project: ProjectDetailsDto): string {
    const category = CATEGORIES[project.category] ?? project.category;
    return [category, ...(project.genre ?? '').split(',')]
      .map(value => value.trim())
      .filter(value => value !== '')
      .join(', ');
  }

  private toStatus(status: string | null): 0 | 1 | 2 | 3 {
    switch (status) {
      case 'completed':
        return 0;
      case 'ongoing':
        return 1;
      case 'paused':
        return 3;
      default:
        return 3;
    }
  }

  private projectIdFromUrl(mangaUrl: string): string {
    const path = new URL(this.absUrl(mangaUrl)).pathname;
    const segment = path.split('/').filter(Boolean).pop() ?? '';
    return segment.substring(segment.lastIndexOf('_') + 1);
  }

  private parseDate(value: string | null): number | undefined {
    if (!value) return undefined;
    const time = Date.parse(value);
    return Number.isNaN(time) ? undefined : time;
  }
}
