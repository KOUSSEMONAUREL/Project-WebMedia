import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface HyakuroCoverAttributes {
  url: string;
}
interface HyakuroCoverData {
  attributes: HyakuroCoverAttributes;
}
interface HyakuroCoverObject {
  data: HyakuroCoverData | null;
}
interface HyakuroPageAttributes {
  url: string;
}
interface HyakuroPageData {
  attributes: HyakuroPageAttributes;
}
interface HyakuroPageListDto {
  data: HyakuroPageData[];
}
interface HyakuroChapterInListDto {
  id: number;
  Chapter: number;
  Title?: string | null;
  TranslatedOn?: string | null;
  Pages?: HyakuroPageListDto | null;
}
interface HyakuroMangaAttributes {
  Title: string;
  slug: string;
  Synopsis?: string | null;
  Artist?: string | null;
  Author?: string | null;
  Status?: string | null;
  Cover?: HyakuroCoverObject | null;
  Chapters?: HyakuroChapterInListDto[] | null;
  Categories?: string[] | null;
  Longstrip?: boolean | null;
  Oneshot?: boolean | null;
  publishedAt?: string | null;
}
interface HyakuroMangaResponse {
  attributes: HyakuroMangaAttributes;
}
interface HyakuroPaginatedResponse {
  data: HyakuroMangaResponse[];
  meta: { pagination: { page: number; pageCount: number } };
}

function toManga(attrs: HyakuroMangaAttributes, baseUrl: string): Manga {
  const thumbnailUrl = attrs.Cover?.data?.attributes?.url ? `${baseUrl}/backend${attrs.Cover.data.attributes.url}` : '';
  const genreParts = [...(attrs.Categories || [])];
  if (attrs.Longstrip) genreParts.push('Longstrip');
  if (attrs.Oneshot) genreParts.push('Oneshot');
  const statusMap: Record<string, 0 | 1 | 2 | 3> = {
    Ongoing: 1,
    Completed: 0,
    Dropped: 2,
  };
  return {
    title: attrs.Title,
    url: `/manga/${attrs.slug}`,
    thumbnailUrl,
    lang: 'en',
    author: attrs.Author || undefined,
    artist: attrs.Artist || undefined,
    description: attrs.Synopsis || undefined,
    genre: genreParts.join(', ') || undefined,
    status: statusMap[attrs.Status || ''] ?? 3,
  };
}

function toChapter(dto: HyakuroChapterInListDto, slug: string, parent: HyakuroMangaAttributes): Chapter {
  const chapterStr = Number.isInteger(dto.Chapter) ? String(dto.Chapter | 0) : String(dto.Chapter);
  const title = dto.Title;
  const oneshot = parent.Oneshot;
  let name = '';
  if (!title && oneshot) name = 'Oneshot';
  else if (!title && !oneshot) name = `Chapter ${chapterStr}`;
  else if (title && oneshot) name = `Oneshot - ${title}`;
  else if (title && !oneshot) name = `Chapter ${chapterStr} - ${title}`;
  else name = `Chapter ${chapterStr}`;
  // url encodes slug#chapter#id for getPageList to retrieve
  const url = `${slug}#${dto.Chapter}#${dto.id}`;
  let dateUpload: number | undefined;
  const dateRaw = dto.TranslatedOn || parent.publishedAt || undefined;
  if (dateRaw) {
    const t = Date.parse(dateRaw);
    if (!isNaN(t)) dateUpload = t;
  }
  return { name, url, dateUpload, chapterNumber: dto.Chapter };
}

export class HyakuroScraper extends BaseScraper {
  readonly name = 'Hyakuro Translations';
  readonly baseUrl = 'https://hyakuro.net';
  readonly lang = 'en';
  private get apiUrl(): string { return `${this.baseUrl}/backend/api`; }

  private parseMangaList(res: HyakuroPaginatedResponse): SearchResult {
    const mangas = res.data.map(r => toManga(r.attributes, this.baseUrl));
    const hasNextPage = res.meta.pagination.page < res.meta.pagination.pageCount;
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.apiUrl}/mangas?populate=Cover,Chapters&sort=Title:asc&pagination[page]=${page}`;
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) as HyakuroPaginatedResponse : res.data as HyakuroPaginatedResponse;
    return this.parseMangaList(data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = `${this.apiUrl}/mangas?populate=Cover,Chapters&sort=updatedAt:desc&pagination[page]=${page}`;
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) as HyakuroPaginatedResponse : res.data as HyakuroPaginatedResponse;
    return this.parseMangaList(data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams();
    params.set('pagination[page]', String(page));
    params.set('populate', 'Cover,Chapters');
    params.set('sort', 'updatedAt:desc');
    if (query.trim()) params.set('filters[Title][$containsi]', query.trim());
    const url = `${this.apiUrl}/mangas?${params.toString()}`;
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) as HyakuroPaginatedResponse : res.data as HyakuroPaginatedResponse;
    return this.parseMangaList(data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.replace(/^\//, '').split('/').pop() || mangaUrl.split('/').pop() || '';
    const cleanSlug = slug.split('#')[0].replace('manga/', '');
    // Re-fetch via slug
    const actualSlug = mangaUrl.includes('/manga/') ? mangaUrl.split('/manga/')[1].split('/')[0].split('#')[0] : cleanSlug;
    const url = `${this.apiUrl}/mangas?filters[slug][$eq]=${encodeURIComponent(actualSlug)}&populate=Cover,Chapters`;
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) as HyakuroPaginatedResponse : res.data as HyakuroPaginatedResponse;
    const attrs = data.data[0]?.attributes;
    if (!attrs) throw new Error('Manga not found');
    return toManga(attrs, this.baseUrl);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.includes('/manga/') ? mangaUrl.split('/manga/')[1].split('/')[0].split('#')[0].split('?')[0] : mangaUrl.split('/').pop()!.split('#')[0];
    const url = `${this.apiUrl}/mangas?filters[slug][$eq]=${encodeURIComponent(slug)}&populate=Cover,Chapters`;
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) as HyakuroPaginatedResponse : res.data as HyakuroPaginatedResponse;
    const attrs = data.data[0]?.attributes;
    if (!attrs) return [];
    const chapters = (attrs.Chapters || []).slice().sort((a, b) => b.Chapter - a.Chapter).map(c => toChapter(c, slug, attrs));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    // chapterUrl is "slug#chapter#id" or full url containing that
    let slug = '';
    let chapterId = 0;
    if (chapterUrl.includes('#')) {
      const parts = chapterUrl.split('#');
      slug = parts[0].split('/').pop() || parts[0];
      if (slug.includes('/manga/')) slug = slug.split('/manga/')[1];
      chapterId = parseInt(parts[2] || parts[1] || '0', 10);
      // If parts like slug#chapter#id, slug is parts[0] last segment
      if (parts[0].includes('/')) {
        const last = parts[0].split('/').pop();
        if (last) slug = last;
      }
      // More robust: if chapterUrl is "/manga/slug" style with hash, extract slug
      if (chapterUrl.includes('/manga/')) {
        const m = chapterUrl.match(/\/manga\/([^/#?]+)/);
        if (m) slug = m[1];
      }
    } else {
      // Fallback: try to extract from URL path /manga/slug/read/num/1
      const m = chapterUrl.match(/\/manga\/([^/]+)\/read\/([^/]+)/);
      if (m) {
        slug = m[1];
        // Need to fetch chapter list to find id
      } else {
        throw new Error('Invalid chapter URL for Hyakuro');
      }
    }
    // If we still don't have id, fetch via slug and match chapter number
    if (!chapterId) {
      const list = await this.getChapterList(`/manga/${slug}`);
      // try to match by URL containing chapterUrl
      const found = list.find(c => chapterUrl.includes(c.url));
      if (found) {
        chapterId = parseInt(found.url.split('#').pop() || '0', 10);
      }
    }
    const url = `${this.apiUrl}/mangas?filters[slug][$eq]=${encodeURIComponent(slug)}&populate[Chapters][populate]=*`;
    const res = await this.get(url, { headers: { Accept: 'application/json' } });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) as HyakuroPaginatedResponse : res.data as HyakuroPaginatedResponse;
    const attrs = data.data[0]?.attributes;
    if (!attrs) throw new Error('Manga not found for pages');
    const chapter = (attrs.Chapters || []).find(c => c.id === chapterId);
    if (!chapter) throw new Error('Chapter not found');
    const pages = (chapter.Pages?.data || [])
      .slice().sort((a, b) => a.attributes.url.localeCompare(b.attributes.url))
      .map((p, index) => ({ index, imageUrl: `${this.baseUrl}/backend${p.attributes.url}` }));
    return pages;
  }

}
