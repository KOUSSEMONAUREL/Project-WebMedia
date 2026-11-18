import { BaseScraper } from './base';
import type { Chapter, Manga, Page, SearchResult } from './types';

const PAGE_SIZE = 48;
const SORT_POPULARITY = 0;
const SORT_RELEASE = 2;
const API_PREFIX = /^\)\]\}',\s*/;
const GENRE_COUNT_REGEX = /\s*\(\d+\)$/;

interface KomikoOptions {
  apiUrl?: string;
  productPath?: string;
  ebookOnly?: boolean;
}

interface ImagesDto {
  img_grande?: string[];
  img_mobile_400?: string[];
}

interface CatalogueProductDto {
  ref?: number;
  seo?: string;
  titre?: string;
  images?: ImagesDto;
}

interface CatalogueDto {
  produits?: CatalogueProductDto[];
  nb?: number;
}

interface GenreDto {
  genre?: string;
}

interface CreditsDto {
  auteur?: string;
  scenariste?: string;
  illustrateur?: string;
}

interface ExtractDto {
  full?: string;
}

interface ProductDetailsDto {
  ref?: number;
  seo?: string;
  titre?: string;
  titre_licence_vo?: string;
  type_licence?: string;
  age?: string;
  date_parution?: string;
  description?: string;
  manga?: CreditsDto;
  genres?: GenreDto[];
  images?: ImagesDto;
  extraits?: ExtractDto[];
}

interface ProductDto {
  produit?: ProductDetailsDto | null;
  message?: string;
}

/**
 * Shops of French manga publishers: an Angular app in front of a JSON API. Only the free
 * previews of the volumes can be read, so every volume is an entry with a single chapter.
 */
export class KomikoEngine extends BaseScraper {
  readonly name: string;
  readonly baseUrl: string;
  readonly lang: string;

  protected readonly apiUrl: string;
  protected readonly productPath: string;
  protected readonly ebookOnly: boolean;

  constructor(name: string, baseUrl: string, lang: string, options: KomikoOptions = {}) {
    super();
    this.name = name;
    this.baseUrl = baseUrl;
    this.lang = lang;
    const host = new URL(baseUrl).host.replace(/^www\./, '');
    this.apiUrl = options.apiUrl ?? `https://api.${host}/v2`;
    this.productPath = options.productPath ?? 'catalogue/produit';
    this.ebookOnly = options.ebookOnly ?? true;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.catalogue(page, SORT_POPULARITY);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.catalogue(page, SORT_RELEASE);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.catalogue(page, SORT_POPULARITY, query.trim());
  }

  private catalogueUrl(page: number, sort: number, query = ''): string {
    const params = new URLSearchParams({
      type: 'manga',
      q: query,
      init: 'false',
      tri: String(sort),
      pageSize: String(PAGE_SIZE),
      pageIndex: String(page - 1),
    });
    if (this.ebookOnly) params.set('ebook', '1');
    return `${this.apiUrl}/catalogue/?${params.toString()}`;
  }

  private async catalogue(page: number, sort: number, query = ''): Promise<SearchResult> {
    const data = await this.parseApi<CatalogueDto>(this.catalogueUrl(page, sort, query));
    const mangas = (data.produits ?? []).map(product => {
      const seo = product.seo ?? '';
      const ref = product.ref ?? 0;
      const url = `/${this.productPath}/${seo}/${ref}`;
      return {
        title: product.titre ?? '',
        url,
        thumbnailUrl: product.images?.img_mobile_400?.[0] ?? product.images?.img_grande?.[0] ?? '',
        lang: this.lang,
      };
    }).filter(manga => manga.title && manga.url);
    return { mangas, hasNextPage: page * PAGE_SIZE < (data.nb ?? 0) };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const product = await this.fetchProduct(this.refFromUrl(mangaUrl));
    const credits = product.manga ?? {};
    const authors = [credits.auteur, credits.scenariste]
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .filter((name, index, list) => list.indexOf(name) === index);
    const altTitles = product.titre_licence_vo?.trim() ? [product.titre_licence_vo.trim()] : [];
    const description = this.buildDescription(product.description, product.type_licence, product.age, altTitles);
    return {
      title: product.titre ?? '',
      url: mangaUrl,
      thumbnailUrl: product.images?.img_grande?.[0] ?? product.images?.img_mobile_400?.[0] ?? '',
      author: authors.join(', ') || undefined,
      artist: credits.illustrateur?.trim() || undefined,
      genre: (product.genres ?? [])
        .map(genre => (genre.genre ?? '').replace(GENRE_COUNT_REGEX, '').trim())
        .filter(Boolean)
        .join(', ') || undefined,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const product = await this.fetchProduct(this.refFromUrl(mangaUrl));
    const pages = product.extraits ?? [];
    if (pages.length === 0) return [];
    return [{
      name: 'Extrait',
      url: mangaUrl,
      dateUpload: this.parseReleaseDate(product.date_parution),
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const product = await this.fetchProduct(this.refFromUrl(chapterUrl));
    return (product.extraits ?? [])
      .map(extract => extract.full ?? '')
      .filter(url => url.length > 0)
      .map((imageUrl, index) => ({ index, imageUrl }));
  }

  private async fetchProduct(ref: string): Promise<ProductDetailsDto> {
    const data = await this.parseApi<ProductDto>(`${this.apiUrl}/produit/?id=${encodeURIComponent(ref)}`);
    if (!data.produit) throw new Error(`${this.name}: ${data.message ?? 'volume not found'}`);
    return data.produit;
  }

  private refFromUrl(url: string): string {
    const segments = url.split('?')[0].split('/').filter(Boolean);
    const ref = segments[segments.length - 1] ?? '';
    if (!/^\d+$/.test(ref)) throw new Error(`${this.name}: invalid volume URL ${url}`);
    return ref;
  }

  private async parseApi<T>(url: string): Promise<T> {
    const res = await this.get(url);
    const body = String(res.data).replace(API_PREFIX, '');
    return JSON.parse(body) as T;
  }

  private buildDescription(raw: string | undefined, type: string | undefined, age: string | undefined, altTitles: string[]): string {
    const text = raw ? this.$(raw).text().replace(/\s+/g, ' ').trim() : '';
    const info = [type, age].filter(Boolean).join(' / ');
    return [
      info ? `[${info}]` : '',
      text,
      altTitles.length > 0 ? `Alternative Titles:\n${altTitles.map(title => `- ${title}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
  }

  private parseReleaseDate(value: string | undefined): number | undefined {
    if (!value || !/^\d{2}-\d{2}-\d{4}$/.test(value)) return undefined;
    const [day, month, year] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }
}
