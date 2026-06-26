import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const j = (d: any) => typeof d === 'string' ? JSON.parse(d) : d;

interface PizzaComic {
  title: string;
  thumbnail: string;
  url: string;
  slug: string;
  author?: string;
  artist?: string;
  description?: string;
  status?: string;
  genres?: { name: string }[];
  chapters?: PizzaChapter[];
  last_chapter?: PizzaChapter;
}

interface PizzaChapter {
  full_title: string;
  url: string;
  published_on: string;
  pages?: string[];
}

export class FmteamScraper extends BaseScraper {
  readonly name = 'FMTEAM';
  readonly baseUrl = 'https://fmteam.fr';
  readonly lang = 'fr';
  private readonly apiUrl = `${this.baseUrl}/api`;

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/comics`);
    const data = j(res.data) as { comics: PizzaComic[] };
    const mangas: Manga[] = data.comics.map(c => ({
      title: c.title,
      url: c.url,
      thumbnailUrl: c.thumbnail,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/comics`);
    const data = j(res.data) as { comics: PizzaComic[] };
    const sorted = data.comics
      .filter(c => c.last_chapter)
      .sort((a, b) => b.last_chapter!.published_on.localeCompare(a.last_chapter!.published_on))
      .slice(0, 10);
    const mangas: Manga[] = sorted.map(c => ({
      title: c.title,
      url: c.url,
      thumbnailUrl: c.thumbnail,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/search/${encodeURIComponent(query)}`);
    const data = j(res.data) as { comics: PizzaComic[] };
    const mangas: Manga[] = data.comics.map(c => ({
      title: c.title,
      url: c.url,
      thumbnailUrl: c.thumbnail,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(`${this.apiUrl}${mangaUrl}`);
    const data = j(res.data) as { comic: PizzaComic };
    const comic = data.comic;
    const genre = comic.genres?.map(g => g.name).join(', ') || undefined;
    return {
      title: comic.title,
      url: comic.url,
      thumbnailUrl: comic.thumbnail,
      author: comic.author || comic.artist || undefined,
      description: comic.description || undefined,
      genre,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(`${this.apiUrl}${mangaUrl}`);
    const data = j(res.data) as { comic: PizzaComic };
    return (data.comic.chapters || []).map(ch => ({
      name: ch.full_title,
      url: ch.url,
      dateUpload: new Date(ch.published_on).getTime() || undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${this.apiUrl}${chapterUrl}`);
    const data = j(res.data) as { chapter: PizzaChapter };
    return (data.chapter.pages || []).map((imageUrl, index) => ({
      index,
      imageUrl,
    }));
  }

}
