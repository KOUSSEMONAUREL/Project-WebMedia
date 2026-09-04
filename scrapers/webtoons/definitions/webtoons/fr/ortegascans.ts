import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import { extractNextJsRsc, extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { JsonObject, NextJsPredicate } from '../../../engine/nextjs';

const MANGA_PREDICATE: NextJsPredicate = value => isJsonObject(value) && 'manga' in value;
const PAGES_PREDICATE: NextJsPredicate = value => isJsonObject(value) && 'images' in value;
const LOCKED_PREFIX = '\u{1F512} ';

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'en cours':
    case 'ongoing': return 1;
    case 'terminé':
    case 'complete': return 0;
    case 'en pause':
    case 'on hold': return 3;
    case 'annulé':
    case 'canceled': return 2;
    default: return 3;
  }
}

export class OrtegascansScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected readonly hidePremium: boolean;

  constructor() {
    super();
    this.name = 'Ortega Scans';
    this.baseUrl = 'https://ortegascans.fr';
    this.lang = 'fr';
    this.hidePremium = true;
  }

  // ------------------------- API (Popular / Latest / Search) -------------------------

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getApiMangasPage(page, '', 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getApiMangasPage(page, '', 'recent');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.getApiMangasPage(page, query, 'popular');
  }

  private async getApiMangasPage(page: number, query: string, sort: string): Promise<SearchResult> {
    const params = new URLSearchParams();
    params.set('limit', '18');
    params.set('page', String(page));
    params.set('search', query);
    params.set('tags', '');
    params.set('status', '');
    params.set('sort', sort);
    params.set('minChapters', '0');
    params.set('isOrtegaOnly', 'false');
    params.set('unreadOnly', 'false');
    params.set('maxChapters', '9999');
    const res = await this.get(`${this.baseUrl}/api/series?${params.toString()}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    const body = isJsonObject(res.data) ? res.data : null;
    const data = body?.data;
    const mangas = Array.isArray(data)
      ? data.filter(isJsonObject).map(dto => this.seriesDtoToManga(dto))
      : [];
    const hasMore = typeof body?.hasMore === 'boolean' ? body.hasMore : false;
    return { mangas, hasNextPage: hasMore };
  }

  private seriesDtoToManga(dto: JsonObject): Manga {
    const slug = this.strOf(dto, 'slug') ?? '';
    return {
      title: this.strOf(dto, 'title') ?? '',
      url: slug,
      thumbnailUrl: this.coverThumb(this.strOf(dto, 'coverImage')),
      lang: this.lang,
    };
  }

  // ------------------------- Details + Chapters -------------------------

  private mangaSlug(mangaUrl: string): string {
    if (/^https?:\/\//i.test(mangaUrl)) {
      const segments = mangaUrl.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean);
      return segments[segments.length - 1] ?? '';
    }
    return mangaUrl;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.mangaSlug(mangaUrl);
    const dto = await this.fetchRsc(`${this.baseUrl}/serie/${slug}`, MANGA_PREDICATE);
    const manga = dto ? isJsonObject(dto.manga) ? dto.manga : null : null;
    if (!manga) return { url: slug, lang: this.lang };
    return this.mangaDtoToDetails(manga, slug);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.mangaSlug(mangaUrl);
    const dto = await this.fetchRsc(`${this.baseUrl}/serie/${slug}`, MANGA_PREDICATE);
    const manga = dto ? isJsonObject(dto.manga) ? dto.manga : null : null;
    if (!manga) return [];
    const chapters = Array.isArray(manga.chapters) ? manga.chapters.filter(isJsonObject) : [];
    return chapters
      .filter(ch => {
        const isPremium = this.boolOf(ch, 'isPremium') ?? false;
        return !this.hidePremium || !isPremium;
      })
      .map(ch => this.chapterDtoToChapter(ch, slug));
  }

  private mangaDtoToDetails(manga: JsonObject, slug: string): Partial<Manga> {
    const descriptionParts: string[] = [];
    const description = this.strOf(manga, 'description');
    if (description) descriptionParts.push(description);
    const altNames = this.strOf(manga, 'alternativeNames');
    if (altNames) descriptionParts.push(`Noms alternatifs : ${altNames}`);
    return {
      title: this.strOf(manga, 'title') || undefined,
      url: slug,
      thumbnailUrl: this.coverThumb(this.strOf(manga, 'coverImage')),
      lang: this.lang,
      description: descriptionParts.join('\n\n') || undefined,
      author: this.strOf(manga, 'author') || undefined,
      artist: this.strOf(manga, 'artist') || undefined,
      status: parseStatus(this.strOf(manga, 'status')),
      genre: this.categoriesOf(manga) || undefined,
    };
  }

  private chapterDtoToChapter(ch: JsonObject, mangaSlug: string): Chapter {
    const number = this.numOf(ch, 'number');
    const numberString = number === undefined ? '' : String(number).replace(/\.0$/, '');
    const title = this.strOf(ch, 'title');
    let name = `Chapitre ${numberString}`;
    if (title) name += ` - ${title}`;
    const isPremium = this.boolOf(ch, 'isPremium') ?? false;
    if (isPremium) name = LOCKED_PREFIX + name;
    const createdAt = this.strOf(ch, 'createdAt');
    const createdAtIso = createdAt ? createdAt.substring(createdAt.startsWith('$D') ? 2 : 0) : undefined;
    const parsed = createdAtIso ? Date.parse(createdAtIso) : NaN;
    return {
      name,
      url: `${this.baseUrl}/serie/${mangaSlug}/chapter/${numberString}`,
      chapterNumber: number,
      dateUpload: Number.isNaN(parsed) ? undefined : parsed,
    };
  }

  // ------------------------- Pages -------------------------

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const path = chapterUrl.split('?')[0];
    const segments = path.replace(/\/+$/, '').split('/').filter(Boolean);
    const chapterIdx = segments.indexOf('chapter');
    if (chapterIdx < 0 || chapterIdx + 1 >= segments.length) return [];
    const slug = segments[chapterIdx - 1] ?? '';
    const number = segments[segments.length - 1] ?? '';
    const dto = await this.fetchRsc(
      `${this.baseUrl}/serie/${slug}/chapter/${number}`,
      PAGES_PREDICATE,
    );
    if (!dto) return [];
    const images = Array.isArray(dto.images) ? dto.images.filter(isJsonObject) : [];
    return images.map(img => {
      const url = this.strOf(img, 'url');
      const index = this.numOf(img, 'index');
      return {
        index: index ?? 0,
        imageUrl: url ? this.absUrl(url) : '',
      };
    });
  }

  // ------------------------- RSC fetcher -------------------------

  private async fetchRsc(url: string, predicate: NextJsPredicate): Promise<JsonObject | null> {
    const res = await this.get(url, { headers: { rsc: '1' } });
    const contentType = String(res.headers['content-type'] ?? '');
    const value = contentType.includes('text/html')
      ? extractNextJsHtml(String(res.data), predicate)
      : extractNextJsRsc(String(res.data), predicate);
    return isJsonObject(value) ? value : null;
  }

  // ------------------------- Utilities -------------------------

  private coverThumb(coverImage: string | undefined): string {
    if (!coverImage) return '';
    const apiPath = coverImage.replace('storage/', 'api/');
    return `${this.baseUrl}/${apiPath}`;
  }

  private categoriesOf(obj: JsonObject): string | undefined {
    if (!Array.isArray(obj.categories)) return undefined;
    const cats = obj.categories.filter((c): c is string => typeof c === 'string');
    return cats.length > 0 ? cats.join(', ') : undefined;
  }

  private strOf(obj: JsonObject, key: string): string | undefined {
    const v = obj[key];
    return typeof v === 'string' ? v : undefined;
  }

  private numOf(obj: JsonObject, key: string): number | undefined {
    const v = obj[key];
    return typeof v === 'number' ? v : undefined;
  }

  private boolOf(obj: JsonObject, key: string): boolean | undefined {
    const v = obj[key];
    return typeof v === 'boolean' ? v : undefined;
  }
}