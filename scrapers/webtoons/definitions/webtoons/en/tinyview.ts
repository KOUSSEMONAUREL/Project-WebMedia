import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface PanelDto {
  title?: string;
  description?: string;
  image?: string;
  action?: string;
  actionType?: string;
  template?: string;
  datetime?: string;
  'show-to'?: string;
  inAppProducts?: unknown;
}

interface ComicDto {
  title?: string;
  description?: string;
  links?: Record<string, string>;
  panels?: PanelDto[];
  ogImage?: string;
  'show-to'?: string;
}

interface ComicResponseDto {
  comics?: ComicDto;
}

const SUBSCRIBERS_ONLY = 'subscribers-only';

export class TinyviewScraper extends BaseScraper {
  readonly name = 'Tinyview';
  readonly baseUrl = 'https://tinyview.com';
  readonly lang = 'en';

  private get cdnUrl(): string {
    return `https://cdn.${new URL(this.baseUrl).host}`;
  }

  private getComicPath(path: string): string {
    return `${this.cdnUrl}${path}/index.json`;
  }

  private async getComic(path: string): Promise<ComicDto> {
    const res = await this.client.get(this.getComicPath(path), {
      headers: { Accept: 'application/json' },
    });
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as ComicResponseDto;
    return data.comics ?? {};
  }

  private isComicOf(panel: PanelDto, series: string): boolean {
    const action = panel.action ?? '';
    return (
      action.startsWith(`/${series}/`) &&
      action.endsWith('/index.json') &&
      !panel.actionType &&
      panel.inAppProducts === undefined
    );
  }

  private comicDate(panel: PanelDto): number {
    if (!panel.datetime) return 0;
    const parsed = Date.parse(panel.datetime);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private imageUrl(path: string, image: string): string {
    return new URL(image, `${this.cdnUrl}${path}/`).toString();
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const directory = await this.getComic('/tinyview/comic-series-directory');
    const mangas = (directory.panels ?? [])
      .filter(panel => Boolean(panel.action) && Boolean(panel.title))
      .map(
        (panel): Manga => ({
          title: panel.title ?? '',
          url: (panel.action ?? '').replace(/\/index\.json$/, ''),
          thumbnailUrl: panel.image ? this.imageUrl('', panel.image) : '',
          description: panel.description,
          lang: this.lang,
        }),
      );
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    if (!term) return this.getPopular();
    const { mangas } = await this.getPopular();
    return {
      mangas: mangas.filter(
        manga => manga.title.toLowerCase().includes(term) || (manga.description ?? '').toLowerCase().includes(term),
      ),
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const path = this.absUrl(mangaUrl).replace(this.baseUrl, '');
    const comic = await this.getComic(path);
    const thumbnail = (comic.panels ?? []).find(panel => panel.image && !panel.action);
    const thumbnailUrl = comic.ogImage ?? thumbnail?.image;
    const links = Object.entries(comic.links ?? {})
      .map(([site, link]) => `${site}: ${link}`)
      .join('\n');

    return {
      title: comic.title,
      url: path,
      description: [comic.description, links].filter(Boolean).join('\n\n') || undefined,
      thumbnailUrl: thumbnailUrl ? this.imageUrl(path, thumbnailUrl) : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const path = this.absUrl(mangaUrl).replace(this.baseUrl, '');
    const series = path.replace(/^\//, '');
    const comic = await this.getComic(path);
    const now = Date.now();

    const comics = (comic.panels ?? [])
      .filter(panel => this.isComicOf(panel, series))
      .filter(panel => this.comicDate(panel) <= now)
      .filter(panel => panel.action && panel.title)
      .reduce<PanelDto[]>((unique, panel) => {
        const panelPath = (panel.action ?? '').replace(/\/index\.json$/, '');
        if (!unique.some(existing => (existing.action ?? '').replace(/\/index\.json$/, '') === panelPath)) {
          unique.push(panel);
        }
        return unique;
      }, [])
      .sort((a, b) => this.comicDate(b) - this.comicDate(a));

    return comics.map((panel, index) => {
      const name = (panel.title ?? '').trim();
      const date = this.comicDate(panel);
      return {
        name: panel['show-to'] === SUBSCRIBERS_ONLY ? `🔒 ${name}` : name,
        url: (panel.action ?? '').replace(/\/index\.json$/, ''),
        chapterNumber: comics.length - index,
        dateUpload: date || undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const path = this.absUrl(chapterUrl).replace(this.baseUrl, '');
    const comic = await this.getComic(path);
    if (comic['show-to'] === SUBSCRIBERS_ONLY) return [];

    return (comic.panels ?? [])
      .filter(panel => panel.image && !panel.action && panel.template !== 'bonus')
      .map((panel, index) => ({
        index,
        imageUrl: this.imageUrl(path, panel.image ?? ''),
      }));
  }
}
