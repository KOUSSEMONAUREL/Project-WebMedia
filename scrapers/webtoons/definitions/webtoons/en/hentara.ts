import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface HentaraGenreDto {
  name: string;
}

interface HentaraComicDto {
  title: string;
  slug: string;
  thumbnail_url?: string | null;
  view_count: number;
  latest_episode_date?: string | null;
  genres: HentaraGenreDto[];
}

interface HentaraIndexDto {
  comics: HentaraComicDto[];
}

interface HentaraComicFullDto {
  title: string;
  slug: string;
  description?: string | null;
  thumbnail_url?: string | null;
  genres: HentaraGenreDto[];
}

interface HentaraEpisodeShortDto {
  episode_number: number;
  title?: string | null;
  created_at?: string | null;
}

interface HentaraMangaDto {
  comic: HentaraComicFullDto;
  episodes: HentaraEpisodeShortDto[];
}

interface HentaraPageDto {
  page_number: number;
  image_url: string;
}

interface HentaraEpisodeDto {
  pages: HentaraPageDto[];
}

const GENRES = [
  'Any', 'Action', 'BL', 'Cheating', 'Detective', 'Drama', 'Harem',
  'In-Law', 'MILF', 'Married', 'Office', 'Romance', 'Spin-Off',
  'Thriller', 'University', 'College', 'Nerd',
];

const SORT_LATEST = 0;
const SORT_POPULAR = 1;
const SORT_ALPHABETICAL = 2;

export class HentaraScraper extends BaseScraper {
  readonly name = 'Hentara';
  readonly baseUrl = 'https://hentara.com';
  readonly lang = 'en';

  private readonly apiBase = 'https://hentara.com/r2-data';

  async getPopular(): Promise<SearchResult> {
    return this.searchIndex('', SORT_POPULAR, 0);
  }

  async getLatest(): Promise<SearchResult> {
    return this.searchIndex('', SORT_LATEST, 0);
  }

  async getSearch(query: string): Promise<SearchResult> {
    return this.searchIndex(query, SORT_LATEST, 0);
  }

  private async searchIndex(query: string, sortIdx: number, genreIdx: number): Promise<SearchResult> {
    const response = await this.get(`${this.apiBase}/index.json`);
    const data = response.data as HentaraIndexDto;
    const genre = GENRES[genreIdx] || 'Any';
    const needle = query.trim().toLowerCase();
    const filtered = (data.comics || []).filter(comic => {
      const matchesQuery = needle === '' || comic.title.toLowerCase().includes(needle);
      const matchesGenre = genre === 'Any' || (comic.genres || []).some(g => g.name.toLowerCase() === genre.toLowerCase());
      return matchesQuery && matchesGenre;
    });
    if (sortIdx === SORT_LATEST) {
      filtered.sort((a, b) => {
        const ta = this.parseDate(a.latest_episode_date);
        const tb = this.parseDate(b.latest_episode_date);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta;
      });
    } else if (sortIdx === SORT_POPULAR) {
      filtered.sort((a, b) => b.view_count - a.view_count);
    } else if (sortIdx === SORT_ALPHABETICAL) {
      filtered.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    }
    return { mangas: filtered.map(comic => this.indexToManga(comic)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const data = await this.fetchComic(mangaUrl);
    const comic = data.comic;
    return {
      url: `/manhwa/${comic.slug}`,
      title: comic.title,
      thumbnailUrl: comic.thumbnail_url || '',
      description: comic.description || undefined,
      genre: (comic.genres || []).map(g => g.name).join(', '),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const data = await this.fetchComic(mangaUrl);
    const comicSlug = data.comic.slug;
    const chapters = (data.episodes || []).map(ep => {
      const name = ep.title && ep.title.trim() !== ''
        ? `Chapter ${ep.episode_number} - ${ep.title}`
        : `Chapter ${ep.episode_number}`;
      const parsed = ep.created_at ? Date.parse(ep.created_at) : NaN;
      return {
        url: `/manhwa/${comicSlug}/chapter-${ep.episode_number}`,
        name,
        chapterNumber: ep.episode_number,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      } as Chapter;
    });
    chapters.sort((a, b) => (b.chapterNumber || 0) - (a.chapterNumber || 0));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const trimmed = chapterUrl.replace(/^\/+|\/+$/g, '');
    const segments = trimmed.split('/');
    if (segments.length < 3) throw new Error(`Malformed chapter URL: ${chapterUrl}`);
    const slug = segments[1];
    const epPart = segments[2];
    if (!slug || !epPart) throw new Error(`Malformed chapter URL: ${chapterUrl}`);
    const ep = Number(epPart.split('chapter-')[1]);
    if (!Number.isInteger(ep)) throw new Error(`Malformed chapter URL: ${chapterUrl}`);
    const response = await this.get(`${this.apiBase}/episodes/${slug}/${ep}.json`);
    const data = response.data as HentaraEpisodeDto;
    return (data.pages || []).map(p => ({ index: p.page_number - 1, imageUrl: p.image_url }));
  }

  private async fetchComic(mangaUrl: string): Promise<HentaraMangaDto> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() || '';
    const response = await this.get(`${this.apiBase}/comics/${slug}.json`);
    return response.data as HentaraMangaDto;
  }

  private indexToManga(comic: HentaraComicDto): Manga {
    return {
      url: `/manhwa/${comic.slug}`,
      title: comic.title,
      thumbnailUrl: comic.thumbnail_url || '',
      genre: (comic.genres || []).map(g => g.name).join(', '),
      lang: this.lang,
    };
  }

  private parseDate(value?: string | null): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
