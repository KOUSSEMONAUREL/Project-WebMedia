import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

interface MonochromeManga {
  title: string;
  description: string;
  author: string;
  artist: string;
  status: string;
  id: string;
  version: number;
}

interface MonochromeChapter {
  name: string;
  volume: number | null;
  number: number;
  scanGroup: string;
  id: string;
  version: number;
  length: number;
  uploadTime: string;
}

interface MonochromeResults {
  offset: number;
  limit: number;
  results: MonochromeManga[];
  total: number;
}

function formatChapterNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace(/\.0$/, '').replace(/(\.\d)0$/, '$1');
}

export abstract class MonochromeCMSScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  protected get apiUrl(): string {
    return this.baseUrl.replace('://', '://api.');
  }

  private mangaFromApi(m: MonochromeManga): Manga {
    const statusLower = m.status.toLowerCase();
    return {
      title: m.title,
      url: m.id,
      thumbnailUrl: `${this.apiUrl}/media/${m.id}/cover.jpg?version=${m.version}`,
      lang: this.lang,
      author: m.author || undefined,
      artist: m.artist || undefined,
      description: m.description || undefined,
      status: statusLower === 'ongoing' || statusLower === 'hiatus' ? 1
        : statusLower === 'completed' || statusLower === 'cancelled' ? 0
        : undefined,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not implemented`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${this.apiUrl}/manga?limit=10&offset=${10 * (page - 1)}&title=${encodeURIComponent(query)}`,
    );
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as MonochromeResults;
    const mangas = (data.results ?? []).map(m => this.mangaFromApi(m));
    const hasNextPage = data.total > (data.results?.length ?? 0) + data.offset * data.limit;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const res = await this.get(`${this.apiUrl}/manga/${id}`);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as MonochromeManga;
    return { ...this.mangaFromApi(data), url: `/manga/${data.id}` };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const res = await this.get(`${this.apiUrl}/manga/${id}/chapters`);
    const list = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as MonochromeChapter[];
    return (list ?? []).map(ch => {
      let name = '';
      if (ch.volume != null) name += `Vol ${ch.volume} `;
      name += `Chapter ${formatChapterNumber(ch.number)}`;
      if (ch.name) name += ` - ${ch.name}`;
      const parsed = Date.parse(ch.uploadTime);
      return {
        name,
        url: `${id}/${ch.id}|${ch.version}|${ch.length}`,
        chapterNumber: ch.number,
        scanlator: ch.scanGroup || undefined,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const [uuid, version, length] = chapterUrl.split('|');
    const total = parseInt(length, 10);
    const pages: Page[] = [];
    for (let i = 1; i <= total; i++) {
      pages.push({ index: i - 1, imageUrl: `${this.apiUrl}/media/${uuid}/${i}.jpg?version=${version}` });
    }
    return pages;
  }
}
