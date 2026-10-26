import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface CoffeeImage {
  n?: number;
  src?: string;
  srcset?: string;
}

interface CoffeeChapter {
  slug: string;
  label: string;
  url: string;
  published_at?: string | null;
}

interface CoffeeSeries {
  slug: string;
  url: string;
  title: string;
  type?: string;
  status?: string;
  cover?: string;
  cover_lg?: string;
  synopsis?: string;
  authors?: Array<{ name: string }>;
  artists?: Array<{ name: string }>;
  genres?: Array<{ name: string }>;
}

interface CoffeeSection {
  code: string;
  items: CoffeeSeries[];
}

interface CoffeeProps {
  series?: CoffeeSeries;
  chapters?: CoffeeChapter[];
  pages?: CoffeeImage[];
  sections?: CoffeeSection[];
  pagination?: { page: number; last: number };
}

interface CoffeePage {
  component: string;
  props: CoffeeProps;
}

function parseStatus(value: string | undefined): MangaStatus {
  switch (value) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    case 'cancelled':
    case 'canceled': return 2;
    default: return undefined;
  }
}

export class CoffeemangaunoriginalScraper extends BaseScraper {
  readonly name = 'Coffee Manga (Unoriginal)';
  readonly baseUrl = 'https://coffeemanga.net';
  readonly lang = 'en';

  private page(html: string): CoffeePage {
    const match = /<script data-page="app" type="application\/json">(.*?)<\/script>/s.exec(html);
    if (!match) throw new Error('Could not find Inertia app data');
    return JSON.parse(match[1]) as CoffeePage;
  }

  private toManga(item: CoffeeSeries): Manga {
    return {
      title: item.title,
      url: item.url,
      thumbnailUrl: item.cover_lg ?? item.cover ?? '',
      lang: this.lang,
    };
  }

  private async homeSection(code: string): Promise<SearchResult> {
    const res = await this.get('/');
    const section = this.page(res.data as string).props.sections?.find(s => s.code === code);
    return { mangas: (section?.items ?? []).map(item => this.toManga(item)), hasNextPage: false };
  }

  async getPopular(): Promise<SearchResult> {
    return this.homeSection('trending');
  }

  async getLatest(): Promise<SearchResult> {
    return this.homeSection('latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query.trim() });
    if (page > 1) params.set('page', String(page));
    const res = await this.get(`/search?${params.toString()}`);
    const props = this.page(res.data as string).props;
    const items = (props.series ?? []) as unknown as CoffeeSeries[];
    return {
      mangas: items.map(item => this.toManga(item)),
      hasNextPage: props.pagination ? props.pagination.page < props.pagination.last : false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const props = this.page(res.data as string).props;
    const item = props.series;
    if (!item) return { url: mangaUrl, lang: this.lang };
    return {
      title: item.title,
      url: item.url,
      thumbnailUrl: item.cover_lg ?? item.cover ?? '',
      description: item.synopsis || undefined,
      author: item.authors?.map(a => a.name).join(', ') || undefined,
      artist: item.artists?.map(a => a.name).join(', ') || undefined,
      genre: item.genres?.map(g => g.name).join(', ') || undefined,
      status: parseStatus(item.status),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const props = this.page(res.data as string).props;
    return (props.chapters ?? []).map(chapter => ({
      name: chapter.label,
      url: chapter.url,
      dateUpload: chapter.published_at ? Date.parse(chapter.published_at) || undefined : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const props = this.page(res.data as string).props;
    return (props.pages ?? [])
      .map((page: CoffeeImage) => page.src ?? '')
      .filter(Boolean)
      .map((imageUrl: string, index: number) => ({ index, imageUrl }));
  }
}

export default CoffeemangaunoriginalScraper;
