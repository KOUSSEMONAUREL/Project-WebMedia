import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `all/kyokotsu` (Kyokotsu.kt + Dto.kt).
 *
 * JSON API at the site root: `/catalog` (lists), `/title?slug=` (details),
 * `/chapters/live` (chapters), `/proxy` + `/proxy/sign` (pages).
 * This port defaults to the English view (`lang=en`), mirroring the
 * upstream `en` source; the `ru` source shares the same endpoints.
 */

const PAGE_SIZE = 20;

interface CatalogItemDto {
  slug: string;
  title_en?: string | null;
  title_ru?: string | null;
  type?: string;
  cover?: string;
  cover_en?: string | null;
}

interface CatalogResponseDto {
  ok: boolean;
  data: { total: number; items: CatalogItemDto[] };
}

interface FullMangaDto {
  slug: string;
  title_en?: string | null;
  title_ru?: string | null;
  type?: string;
  description?: string | null;
  description_en?: string | null;
  status?: string | null;
  genres?: string[];
  tags?: string[];
  author?: string | null;
  author_en?: string | null;
  cover?: string;
  cover_en?: string | null;
}

interface TitleResponseDto {
  ok: boolean;
  data: FullMangaDto;
}

interface ChapterItemDto {
  id: number;
  title_slug: string;
  chapter_id?: string | null;
  number: string;
  name?: string | null;
  pub_date?: string | null;
  is_mangalib?: boolean | null;
  is_mangadex?: boolean | null;
  is_weebcentral?: boolean | null;
  is_inkstory?: boolean | null;
}

interface ChaptersResponseDto {
  ok: boolean;
  data: ChapterItemDto[];
}

interface PagesResponseDto {
  ok: boolean;
  data: string[];
}

const TYPE_MAP: Record<string, string> = {
  'Манга': 'manga',
  'Манхва': 'manhwa',
  'Маньхуа': 'manhua',
  'Комикс': 'comics',
};

function pickTitle(lang: string, en?: string | null, ru?: string | null): string {
  if (lang === 'ru') return (ru && ru.trim()) || (en && en.trim()) || '';
  return (en && en.trim()) || (ru && ru.trim()) || '';
}

function pickCover(lang: string, en?: string | null, ru?: string | null): string {
  if (lang === 'ru') return ru || '';
  return en || ru || '';
}

export class KyokotsuScraper extends BaseScraper {
  readonly name = 'Kyokotsu';
  readonly baseUrl = 'https://kyokotsu.com';
  readonly lang = 'all';

  private readonly apiLang = 'en';

  /** The catalog API does content negotiation: with the base HTML `Accept`
   * header it serves the SSR page, so force JSON here and parse defensively. */
  private async apiGet<T>(url: string): Promise<T> {
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = res.data;
    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as T;
      } catch {
        return data as unknown as T;
      }
    }
    return data as T;
  }

  private toManga(item: CatalogItemDto): Manga {
    return {
      title: pickTitle(this.apiLang, item.title_en, item.title_ru),
      url: item.slug,
      thumbnailUrl: pickCover(this.apiLang, item.cover_en, item.cover),
      lang: this.lang,
    };
  }

  private async fetchCatalog(page: number, sort: string, query?: string): Promise<SearchResult> {
    const params = new URLSearchParams({
      sort,
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
      lang: this.apiLang,
    });
    if (query && query.trim()) params.set('q', query.trim());
    const body = await this.apiGet<CatalogResponseDto>(`${this.baseUrl}/catalog?${params.toString()}`);
    const items = body.data?.items ?? [];
    const total = body.data?.total ?? 0;
    return {
      mangas: items.map(item => this.toManga(item)),
      hasNextPage: page * PAGE_SIZE < total,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchCatalog(page, 'popularity');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.fetchCatalog(page, 'updated');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.fetchCatalog(page, 'popularity', query);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const dto = (await this.apiGet<TitleResponseDto>(
      `${this.baseUrl}/title?slug=${encodeURIComponent(slug)}`,
    )).data;
    const statusText = dto.status || '';
    const status: Manga['status'] = /выходит|онгоинг|продолжается/i.test(statusText)
      ? 1
      : /заверш|закончен/i.test(statusText)
        ? 0
        : undefined;
    const genre = [...(dto.genres ?? []), ...(dto.tags ?? [])].filter(Boolean).join(', ') || undefined;
    return {
      title: pickTitle(this.apiLang, dto.title_en, dto.title_ru),
      url: dto.slug,
      thumbnailUrl: pickCover(this.apiLang, dto.cover_en, dto.cover),
      description: (dto.description_en || dto.description || undefined)?.replace(/\*/g, ''),
      author: dto.author_en || dto.author || undefined,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const items = (await this.apiGet<ChaptersResponseDto>(
      `${this.baseUrl}/chapters/live?fresh=1&slug=${encodeURIComponent(slug)}&lang=${this.apiLang}`,
    )).data ?? [];
    const chapters: Chapter[] = items.map(item => {
      const num = (item.number || '').trim();
      const name = item.name?.trim();
      const key = item.chapter_id || String(item.id);
      return {
        name: name ? `Chapter ${num} - ${name}` : `Chapter ${num}`,
        url: `${slug}#${key}#${num}`,
        chapterNumber: Number(num) || -1,
        dateUpload: item.pub_date ? Date.parse(item.pub_date) : undefined,
      };
    });
    void TYPE_MAP;
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const segments = chapterUrl.split('#');
    const chapterId = segments[segments.length - 2] || segments[segments.length - 1] || '';
    for (const endpoint of [
      `${this.baseUrl}/weebcentral/pages?chapter_id=${encodeURIComponent(chapterId)}`,
      `${this.baseUrl}/mangadex/pages?chapter_id=${encodeURIComponent(chapterId)}`,
    ]) {
      try {
        const data = (await this.apiGet<PagesResponseDto>(endpoint)).data ?? [];
        if (data.length > 0) return data.map((u, index) => ({ index, imageUrl: `${this.baseUrl}${u}` }));
      } catch {
        continue;
      }
    }
    const body = await this.apiGet<{ content?: { pages?: { link?: string }[][] } } & PagesResponseDto>(
      `${this.baseUrl}/proxy?e=${Buffer.from(`https://api.remanga.org/api/titles/chapters/${chapterId}/`).toString('base64')}`,
    );
    if (body && typeof body === 'object' && 'content' in body && body.content?.pages) {
      const links = (body.content.pages.flat().map(p => p.link).filter(Boolean) as string[])
        .map(l => l.replace('img.reimg.org', 'img.reimg2.org'));
      const signRes = await this.post(`${this.baseUrl}/proxy/sign`, { urls: links });
      const signed = (signRes.data as PagesResponseDto).data ?? [];
      return signed.map((u, index) => ({ index, imageUrl: `${this.baseUrl}${u}` }));
    }
    const items = (body as PagesResponseDto).data ?? [];
    return items.map((u, index) => ({ index, imageUrl: `${this.baseUrl}${u}` }));
  }
}
