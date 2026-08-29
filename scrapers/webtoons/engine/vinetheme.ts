import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from './types';
import { extractNextJsRsc, extractNextJsHtml, isJsonObject } from './nextjs';
import type { Json, JsonObject, NextJsPredicate } from './nextjs';

// Mirrors upstream StripEmoji: keeps ASCII, letters, digits, dashes and spaces.
const STRIP_EMOJI_RE = /[^\x00-\x7F\p{L}0-9\- ]+/gu;
const LOCKED_PREFIX = '\u{1F512} ';

const SERIES_CHAPTERS_PREDICATE: NextJsPredicate = value =>
  isJsonObject(value) && 'series' in value && 'chapters' in value;
const CHAPTER_PREDICATE: NextJsPredicate = value => isJsonObject(value) && 'chapter' in value;

export abstract class VineThemeScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected readonly hideLocked: boolean;

  constructor(name: string, baseUrl: string, lang: string, hideLocked = true) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
    this.hideLocked = hideLocked;
  }

  // ------------------------- API (Popular / Latest / Search) -------------------------

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getApiMangasPage(page, 'popular', '');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getApiMangasPage(page, 'updated', '');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.getApiMangasPage(page, 'updated', query);
  }

  private async getApiMangasPage(page: number, sort: string, query: string): Promise<SearchResult> {
    const params = new URLSearchParams();
    params.set('sort', sort);
    params.set('contentMode', 'comics');
    params.set('page', String(page));
    params.set('limit', '24');
    if (query) params.set('q', query);
    const res = await this.get(`${this.baseUrl}/api/series?${params.toString()}`, this.apiHeaders());
    const body = isJsonObject(res.data) ? res.data : null;
    const data = body?.data;
    const mangas = Array.isArray(data)
      ? data
          .filter(isJsonObject)
          .map(dto => this.dtoToManga(dto))
      : [];
    const meta = isJsonObject(body?.meta) ? body!.meta : null;
    const hasMore = this.boolOf(meta, 'hasMore') ?? false;
    return { mangas, hasNextPage: hasMore };
  }

  // ------------------------- Details + Chapters -------------------------

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const detail = await this.fetchDetail(mangaUrl);
    const series = detail && isJsonObject(detail.series) ? detail.series : null;
    if (!series) return { url: mangaUrl, lang: this.lang };
    return { ...this.dtoToManga(series), url: mangaUrl };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    const detail = await this.fetchDetail(mangaUrl);
    if (!detail) return [];
    const first = this.listOf(detail.chapters);
    const totalPages = this.numOf(detail, 'totalPages') ?? 1;
    const allChapters: JsonObject[] = [...first];
    if (totalPages > 1) {
      for (let page = 2; page <= totalPages; page++) {
        const pageDetail = await this.fetchDetail(mangaUrl, page);
        if (pageDetail) allChapters.push(...this.listOf(pageDetail.chapters));
      }
    }
    const chapters = allChapters
      .filter(ch => {
        const isLocked = this.boolOf(ch, 'isLocked') ?? false;
        return !(isLocked && this.hideLocked);
      })
      .map(ch => this.dtoToChapter(ch, slug));
    const seen = new Set<string>();
    const unique = chapters.filter(ch => {
      if (seen.has(ch.url)) return false;
      seen.add(ch.url);
      return true;
    });
    unique.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
    return unique;
  }

  private async fetchDetail(mangaUrl: string, page?: number): Promise<JsonObject | null> {
    const urlObj = new URL(this.absUrl(mangaUrl));
    urlObj.searchParams.set('sort', 'desc');
    if (page !== undefined) urlObj.searchParams.set('page', String(page));
    return this.fetchRsc(urlObj.toString(), SERIES_CHAPTERS_PREDICATE);
  }

  // ------------------------- Pages -------------------------

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const data = await this.fetchRsc(this.absUrl(chapterUrl), CHAPTER_PREDICATE);
    if (!data) return [];
    const chapter = isJsonObject(data.chapter) ? data.chapter : null;
    const pages = chapter ? this.listOf(chapter.pages) : [];
    const out: Page[] = [];
    pages.forEach((pageDto, index) => {
      const imageUrl = this.strOf(pageDto, 'imageUrl');
      if (imageUrl) out.push({ index, imageUrl: this.absUrl(imageUrl) });
    });
    return out;
  }

  // ------------------------- RSC fetcher -------------------------

  private apiHeaders() {
    return {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    };
  }

  private async fetchRsc(url: string, predicate: NextJsPredicate): Promise<JsonObject | null> {
    const res = await this.get(url, { headers: { rsc: '1' } });
    const contentType = String(res.headers['content-type'] ?? '');
    const value = contentType.includes('text/html')
      ? extractNextJsHtml(String(res.data), predicate)
      : extractNextJsRsc(String(res.data), predicate);
    return isJsonObject(value) ? value : null;
  }

  // ------------------------- DTO mapping -------------------------

  private dtoToManga(dto: JsonObject): Manga {
    const id = this.strOf(dto, 'id') ?? '';
    const title = this.strOf(dto, 'title') ?? '';
    const slug = this.strOf(dto, 'slug') ?? '';
    const coverUrl = this.strOf(dto, 'coverImage');
    const type = this.strOf(dto, 'type')?.trim();
    const origin = this.strOf(dto, 'origin')?.trim();
    const isMature = this.boolOf(dto, 'isMature') ?? false;
    const isHot = this.boolOf(dto, 'isHot') ?? false;
    const rating = this.numOf(dto, 'rating');
    const salePercent = this.numOf(dto, 'salePercent');
    const team = isJsonObject(dto.team) ? dto.team : null;

    const genreParts: string[] = [];
    if (type) genreParts.push(type);
    if (origin) genreParts.push(origin);
    if (isMature) genreParts.push('Mature');
    const genres = Array.isArray(dto.genres) ? dto.genres.filter(isJsonObject) : [];
    for (const genre of genres) {
      const display = this.genreDisplayName(genre);
      if (display) genreParts.push(display);
    }
    const genre = [...new Set(genreParts)].join(', ') || undefined;

    const info: string[] = [];
    if (rating !== undefined && rating > 0) info.push(`Rating: ${rating}`);
    if (type) info.push(`Type: ${type}`);
    if (origin) info.push(`Origin: ${origin}`);
    if (isHot) info.push('Featured');
    if (isMature) info.push('Mature');
    if (salePercent !== undefined && salePercent > 0) info.push(`Sale: ${salePercent}%`);

    const originalTitle = this.strOf(dto, 'originalTitle');
    const aliases = Array.isArray(dto.aliases)
      ? dto.aliases.filter((a): a is string => typeof a === 'string')
      : [];
    const altTitles = [...new Set(
      [originalTitle, ...aliases]
        .filter((s): s is string => typeof s === 'string')
        .map(s => s.trim())
        .filter(s => s !== '' && s.toLowerCase() !== title.toLowerCase()),
    )];

    const parts: string[] = [];
    const descriptionHtml = this.strOf(dto, 'description');
    if (descriptionHtml) {
      const text = this.htmlToText(descriptionHtml);
      if (text) parts.push(text);
    }
    if (info.length > 0) {
      if (parts.length > 0) parts.push('');
      parts.push(info.join('\n'));
    }
    if (altTitles.length > 0) {
      if (parts.length > 0) parts.push('');
      parts.push('Alternative titles: \n' + altTitles.map(t => `- ${t}`).join('\n'));
    }
    const description = parts.join('\n').replace(/\n{3,}/g, '\n\n') || undefined;

    return {
      title,
      url: slug ? `${this.baseUrl}/series/comic/${slug}` : this.baseUrl,
      thumbnailUrl: coverUrl ? this.absUrl(coverUrl) : '',
      lang: this.lang,
      author: team ? this.strOf(team, 'name') ?? undefined : undefined,
      genre,
      description,
      status: this.statusToManga(this.strOf(dto, 'status')),
    };
  }

  private genreDisplayName(genre: JsonObject): string {
    const name = this.strOf(genre, 'name');
    if (name && name.replace(STRIP_EMOJI_RE, '').trim()) {
      return name.replace(STRIP_EMOJI_RE, '').trim();
    }
    const nested = isJsonObject(genre.genre) ? genre.genre : null;
    const slug = nested ? this.strOf(nested, 'slug') ?? '' : '';
    return slug.replace(STRIP_EMOJI_RE, '').trim();
  }

  private dtoToChapter(ch: JsonObject, slug: string): Chapter {
    const number = this.numOf(ch, 'number');
    const numberString = number === undefined ? '' : String(number).replace(/\.0$/, '');
    const rawTitle = this.strOf(ch, 'title');
    let name: string;
    if (!rawTitle || rawTitle.trim() === '' || rawTitle.trim() === numberString) {
      name = `Chapter ${numberString}`;
    } else {
      name = rawTitle.trim();
    }
    const isLocked = this.boolOf(ch, 'isLocked') ?? false;
    if (isLocked) name = LOCKED_PREFIX + name;
    const publishedAt = this.strOf(ch, 'publishedAt');
    const dateUpload = publishedAt ? Date.parse(publishedAt) : NaN;
    return {
      name,
      url: `${this.baseUrl}/series/comic/${slug}/chapter/${numberString}`,
      chapterNumber: number,
      dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
    };
  }

  private statusToManga(status: string | undefined): MangaStatus {
    switch (status) {
      case 'ONGOING': return 1;
      case 'COMPLETED': return 0;
      case 'CANCELLED': return 2;
      case 'HIATUS': return 3;
      default: return 3;
    }
  }

  // ------------------------- Utilities -------------------------

  private slugFromUrl(url: string): string {
    const segments = url.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '';
  }

  private htmlToText(html: string): string {
    const $ = this.$(html);
    $('a[href]').each((_, el) => {
      const $el = $(el);
      const url = this.absUrl($el.attr('href') || '');
      const text = $el.text().trim();
      $el.replaceWith(text ? `[${text}](${url})` : url);
    });
    $('p').each((_, el) => {
      $(el).after('\n\n');
    });
    $('br').each((_, el) => {
      $(el).replaceWith('\n');
    });
    return $('body').text().replace(/\n{3,}/g, '\n\n').trim();
  }

  private strOf(obj: JsonObject | null, key: string): string | undefined {
    if (!obj) return undefined;
    const v = obj[key];
    return typeof v === 'string' ? v : undefined;
  }

  private numOf(obj: JsonObject, key: string): number | undefined {
    const v = obj[key];
    return typeof v === 'number' ? v : undefined;
  }

  private boolOf(obj: JsonObject | null, key: string): boolean | undefined {
    if (!obj) return undefined;
    const v = obj[key];
    return typeof v === 'boolean' ? v : undefined;
  }

  private listOf(value: Json | undefined): JsonObject[] {
    return Array.isArray(value) ? value.filter(isJsonObject) : [];
  }
}