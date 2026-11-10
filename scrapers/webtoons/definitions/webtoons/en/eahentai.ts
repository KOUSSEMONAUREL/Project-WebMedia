import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface AlbumDto {
  albumID: number;
  addDt: string;
  thumbnailUri: string;
  title: string;
  tags?: string | null;
  characters?: string | null;
  from?: string | null;
  author?: string | null;
  albumType?: string | null;
  aiDescription?: string | null;
  images?: ImageDto[];
}

interface ImageDto {
  imageUri: string;
  sort: number;
}

interface AlbumListDto {
  items: AlbumDto[];
  totalPages: number;
}

const PAGE_SIZE = 42;
const SORT_ALL_TIME = 'views_alltime';
const IMAGE_URL = 'https://i.eahentai.com/file/ea-gallery/';

export class EAHentaiScraper extends BaseScraper {
  override readonly name = 'EAHentai';
  override readonly baseUrl = 'https://eahentai.com';
  override readonly lang = 'en';

  private get apiUrl(): string {
    return `${this.baseUrl}/api/image`;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchPopular(page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = new URL(`${this.apiUrl}/latest/`);
    url.searchParams.set('page', (page - 1).toString());
    url.searchParams.set('take', PAGE_SIZE.toString());
    const response = await this.get(url.toString());
    const result = response.data as AlbumListDto;
    return {
      mangas: result.items.map(album => this.toManga(album)),
      hasNextPage: page < result.totalPages,
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim() === '') {
      return this.fetchPopular(page);
    }

    const url = new URL(`${this.apiUrl}/search/v2/`);
    url.searchParams.set('type', 'gallery');
    url.searchParams.set('q', query.trim());
    url.searchParams.set('take', PAGE_SIZE.toString());
    url.searchParams.set('page', (page - 1).toString());
    url.searchParams.set('orderby', SORT_ALL_TIME);
    const response = await this.get(url.toString());
    const result = response.data as AlbumListDto;
    return {
      mangas: result.items.map(album => this.toManga(album)),
      hasNextPage: page < result.totalPages,
    };
  }

  private async fetchPopular(page: number): Promise<SearchResult> {
    const url = new URL(`${this.apiUrl}/popular/`);
    url.searchParams.set('page', (page - 1).toString());
    url.searchParams.set('take', PAGE_SIZE.toString());
    url.searchParams.set('orderby', SORT_ALL_TIME);
    const response = await this.get(url.toString());
    const albums = response.data as AlbumDto[];
    return {
      mangas: albums.map(album => this.toManga(album)),
      hasNextPage: albums.length === PAGE_SIZE,
    };
  }

  private toManga(album: AlbumDto): Manga {
    return {
      title: album.title.trim(),
      url: `${this.baseUrl}/a/${album.albumID}`,
      thumbnailUrl: this.imageUrl(album.thumbnailUri),
      lang: this.lang,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const album = await this.fetchAlbum(this.albumIdFromUrl(mangaUrl));
    const parts: string[] = [];
    if (album.aiDescription) parts.push(album.aiDescription);
    const parodies = this.splitValues(album.from);
    if (parodies.length > 0) parts.push(`Parodies: ${parodies.join(', ')}`);
    const characters = this.splitValues(album.characters);
    if (characters.length > 0) parts.push(`Characters: ${characters.join(', ')}`);

    return {
      title: album.title.trim(),
      url: `${this.baseUrl}/a/${album.albumID}`,
      thumbnailUrl: this.imageUrl(album.thumbnailUri),
      lang: this.lang,
      author: this.splitValues(album.author).join(', ') || undefined,
      genre: [...this.splitValues(album.albumType), ...this.splitValues(album.tags)].join(', ') || undefined,
      description: parts.join('\n\n') || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.albumIdFromUrl(mangaUrl);
    const album = await this.fetchAlbum(id);
    return [{
      name: 'Chapter',
      url: `${this.baseUrl}/a/${id}/0`,
      dateUpload: this.parseDate(album.addDt),
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const album = await this.fetchAlbum(this.albumIdFromUrl(chapterUrl));
    return (album.images ?? [])
      .slice()
      .sort((a, b) => a.sort - b.sort)
      .map((image, index) => ({
        index,
        imageUrl: this.imageUrl(image.imageUri),
      }));
  }

  private async fetchAlbum(id: string): Promise<AlbumDto> {
    const response = await this.get(`${this.apiUrl}/album/${id}`);
    const album = (response.data as AlbumDto[])[0];
    if (!album) {
      throw new Error(`EAHentai: album ${id} not found`);
    }
    return album;
  }

  private albumIdFromUrl(url: string): string {
    const segments = new URL(this.absUrl(url)).pathname.split('/').filter(Boolean);
    const index = segments.indexOf('a');
    return index >= 0 ? segments[index + 1] || '' : segments[segments.length - 1] || '';
  }

  private imageUrl(uri: string): string {
    return IMAGE_URL + uri.split('/').map(part => encodeURIComponent(part)).join('/');
  }

  private splitValues(value: string | null | undefined): string[] {
    return (value ?? '').split('|').map(part => part.trim()).filter(part => part !== '');
  }

  private parseDate(value: string): number | undefined {
    if (!value) return undefined;
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
    const time = Date.parse(normalized);
    return Number.isNaN(time) ? undefined : time;
  }
}
