import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface ChapterRoot {
  url: string;
  mode: string;
  data: unknown;
}

interface LibraryEntry {
  id: string;
  title: string;
  cover: string;
  chapters: string[];
  chapter_roots?: Record<string, ChapterRoot>;
}

const MAX_PAGES = 150;

export class LeslievictimsScraper extends BaseScraper {
  readonly name = 'Leslie&Victims';
  readonly baseUrl = 'https://leslie-victims.pages.dev';
  readonly lang = 'en';

  private async getLibrary(): Promise<LibraryEntry[]> {
    const res = await this.get('/manga.json');
    return res.data as LibraryEntry[];
  }

  private seriesUrl(seriesId: string): string {
    return `/?series=${encodeURIComponent(seriesId)}`;
  }

  private chapterUrl(seriesId: string, chId: string): string {
    return `/?series=${encodeURIComponent(seriesId)}&ch=${encodeURIComponent(chId)}`;
  }

  private toManga(entry: LibraryEntry): Manga {
    return {
      title: entry.title,
      url: this.seriesUrl(entry.id),
      thumbnailUrl: `${this.baseUrl}/${entry.cover}`,
      lang: this.lang,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const entries = await this.getLibrary();
    return { mangas: entries.map(e => this.toManga(e)), hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const entries = await this.getLibrary();
    const mangas = entries
      .filter(e => e.title.toLowerCase().includes(query.toLowerCase()))
      .map(e => this.toManga(e));
    return { mangas, hasNextPage: false };
  }

  private seriesIdFrom(mangaUrl: string): string {
    const url = new URL(this.absUrl(mangaUrl));
    const seriesId = url.searchParams.get('series');
    if (!seriesId) throw new Error('Invalid manga URL');
    return seriesId;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const seriesId = this.seriesIdFrom(mangaUrl);
    const entries = await this.getLibrary();
    const entry = entries.find(e => e.id === seriesId);
    if (!entry) throw new Error(`Series not found: ${seriesId}`);
    return this.toManga(entry);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const seriesId = this.seriesIdFrom(mangaUrl);
    const entries = await this.getLibrary();
    const entry = entries.find(e => e.id === seriesId);
    if (!entry) throw new Error(`Series not found: ${seriesId}`);

    return entry.chapters.slice().reverse().map(chId => {
      const num = parseFloat(chId.split(' ')[0]);
      return {
        name: `Chapter ${chId}`,
        url: this.chapterUrl(seriesId, chId),
        chapterNumber: Number.isNaN(num) ? -1 : num,
      };
    });
  }

  private async probeImage(url: string): Promise<boolean> {
    try {
      const res = await this.client.head(url);
      return res.status >= 200 && res.status < 300 && String(res.headers['content-type'] || '').startsWith('image');
    } catch {
      return false;
    }
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(this.absUrl(chapterUrl));
    const seriesId = url.searchParams.get('series');
    const chId = url.searchParams.get('ch');
    if (!seriesId) throw new Error('Missing series ID in chapter URL');
    if (!chId) throw new Error('Missing chapter ID in chapter URL');

    const entries = await this.getLibrary();
    const entry = entries.find(e => e.id === seriesId);
    if (!entry) throw new Error(`Series not found: ${seriesId}`);

    const chapterRoot = entry.chapter_roots?.[chId];

    if (chapterRoot) {
      const rootUrl = chapterRoot.url;
      if (chapterRoot.mode === 'list' && Array.isArray(chapterRoot.data)) {
        return (chapterRoot.data as string[]).map((file, i) => ({
          index: i,
          imageUrl: `${rootUrl}/${file}`,
        }));
      }
      if (chapterRoot.mode === 'count') {
        const count = parseInt(`${chapterRoot.data}`, 10);
        if (!Number.isNaN(count)) {
          return Array.from({ length: count }, (_, i) => ({
            index: i,
            imageUrl: `${rootUrl}/${(i + 1).toString().padStart(2, '0')}.webp`,
          }));
        }
      }
    }

    const baseImgUrl = `${this.baseUrl}/content/${seriesId}/${chId}`;
    const pages: Page[] = [];
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const imgUrl = `${baseImgUrl}/${pageNum.toString().padStart(2, '0')}.webp`;
      if (await this.probeImage(imgUrl)) {
        pages.push({ index: pageNum - 1, imageUrl: imgUrl });
      } else {
        break;
      }
    }
    return pages;
  }
}