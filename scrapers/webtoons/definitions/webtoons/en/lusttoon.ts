import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://back.lustoon.com';

interface SearchItemDto {
  name?: string | null;
  slug?: string | null;
  urlImg?: string | null;
}

interface SearchResponseDto {
  data: SearchItemDto[];
  meta?: { current_page: number; last_page: number } | null;
}

interface SerieDto {
  name?: string | null;
  slug?: string | null;
  urlImg?: string | null;
  sinopsis?: string | null;
  state?: { estado: string } | null;
  genders?: { name: string }[] | null;
  chapters?: ChapterDto[] | null;
}

interface ChapterDto {
  slug?: string | null;
  num?: number | null;
  name?: string | null;
  createdAt?: string | null;
}

interface SerieResponse {
  serie: SerieDto;
}

interface PagechesResponse {
  pageches: { urlImg: string };
}

export class LustToonScraper extends BaseScraper {
  readonly name = 'LustToon';
  readonly baseUrl = 'https://lustoon.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = new URL(`${API_URL}/filtrar`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '24');
    url.searchParams.set('orderBy', '6');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('gendersId', '');
    url.searchParams.set('origin', '');
    url.searchParams.set('state', '');
    url.searchParams.set('loading', 'true');
    const res = await this.get(url.toString());
    const dto = res.data as SearchResponseDto;
    const mangas = (dto.data ?? []).filter((i) => i.slug).map((i) => this.searchItemToManga(i));
    const hasNext = dto.meta ? dto.meta.current_page < dto.meta.last_page : false;
    return { mangas, hasNextPage: hasNext };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    // page 1 alternative via RSC is ignored; use API filtrar with orderBy 3
    // Kotlin uses page-1 for API when page>1 via latest; we mirror popular/latest logic
    const apiPage = page > 1 ? String(page - 1) : '1';
    // Try RSC-like home comics for page 1 first via baseUrl with RSC header is not needed; fallback to filtrar
    const url = new URL(`${API_URL}/filtrar`);
    url.searchParams.set('page', apiPage);
    url.searchParams.set('limit', '24');
    url.searchParams.set('orderBy', '3');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('gendersId', '');
    url.searchParams.set('origin', '');
    url.searchParams.set('state', '');
    url.searchParams.set('loading', 'true');
    const res = await this.get(url.toString());
    const dto = res.data as SearchResponseDto;
    const mangas = (dto.data ?? []).filter((i) => i.slug).map((i) => this.searchItemToManga(i));
    const hasNext = dto.meta ? dto.meta.current_page < dto.meta.last_page : mangas.length > 0;
    return { mangas, hasNextPage: hasNext };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim()) {
      const url = new URL(`${API_URL}/home/buscar`);
      url.searchParams.set('query', query);
      const res = await this.get(url.toString());
      const items = res.data as SearchItemDto[];
      const mangas = (Array.isArray(items) ? items : []).filter((i) => i.slug).map((i) => this.searchItemToManga(i));
      return { mangas, hasNextPage: false };
    }
    const url = new URL(`${API_URL}/filtrar`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '24');
    url.searchParams.set('loading', 'true');
    url.searchParams.set('orderBy', '1');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('gendersId', '');
    url.searchParams.set('origin', '');
    url.searchParams.set('state', '');
    const res = await this.get(url.toString());
    const dto = res.data as SearchResponseDto;
    const mangas = (dto.data ?? []).filter((i) => i.slug).map((i) => this.searchItemToManga(i));
    const hasNext = dto.meta ? dto.meta.current_page < dto.meta.last_page : false;
    return { mangas, hasNextPage: hasNext };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.extractSlug(mangaUrl);
    if (!slug) return { title: '', url: mangaUrl, thumbnailUrl: '', lang: this.lang };
    const res = await this.get(`${API_URL}/serie/${slug}`);
    const data = res.data as SerieResponse & SerieDto;
    const serie: SerieDto = (data as SerieResponse).serie ?? (data as SerieDto);
    if (!serie || !serie.slug) throw new Error(`Serie not found for ${slug}`);
    return this.serieToManga(serie, mangaUrl);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.extractSlug(mangaUrl);
    if (!slug) return [];
    const res = await this.get(`${API_URL}/serie/${slug}`);
    const data = res.data as SerieResponse & SerieDto;
    const serie: SerieDto = (data as SerieResponse).serie ?? (data as SerieDto);
    const chapters = serie.chapters ?? [];
    return chapters
      .filter((c) => c.slug)
      .map((c) => this.chapterToChapter(c, slug));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const { mangaSlug, chapterSlug } = this.extractChapterParts(chapterUrl);
    if (!mangaSlug || !chapterSlug) {
      // Fallback: try to fetch chapterUrl directly and regex images
      return this.getPageListViaHtml(chapterUrl);
    }
    try {
      const res = await this.get(`${API_URL}/serie/${mangaSlug}/${chapterSlug}`);
      const data = res.data as PagechesResponse & Record<string, unknown>;
      const pageches = (data as PagechesResponse).pageches ?? (data as unknown as { urlImg: string });
      const urlImgRaw = pageches?.urlImg;
      if (urlImgRaw) {
        let images: string[] = [];
        try {
          const parsed = JSON.parse(urlImgRaw) as unknown;
          if (Array.isArray(parsed)) images = parsed as string[];
        } catch {
          // fallback regex
        }
        if (images.length > 0) {
          return images
            .map((u) => u.replace('http://', 'https://'))
            .filter((u) => !u.includes('brakeout'))
            .map((url, index) => ({ index, imageUrl: url }));
        }
      }
    } catch {
      // fall through to HTML parsing
    }
    return this.getPageListViaHtml(chapterUrl);
  }

  private async getPageListViaHtml(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const html = res.data as string;
    const regex = /https?:\/\/media\.lustoon\.com\/file\/[^"'\s]+\.(?:jpg|jpeg|png|webp|avif)/gi;
    const matches = html.match(regex) ?? [];
    const distinct = [...new Set(matches.map((u) => u.replace('http://', 'https://')))].filter(
      (u) => !u.includes('brakeout') && u.includes('/serie/'),
    );
    return distinct.map((url, index) => ({ index, imageUrl: url }));
  }

  private searchItemToManga(item: SearchItemDto): Manga {
    return {
      title: item.name ?? '',
      url: `/comic/${item.slug}`,
      thumbnailUrl: (item.urlImg ?? '').replace('http://', 'https://'),
      lang: this.lang,
    };
  }

  private serieToManga(serie: SerieDto, mangaUrl: string): Partial<Manga> {
    const status = this.parseStatus(serie.state?.estado);
    return {
      title: serie.name ?? '',
      url: mangaUrl.includes('/comic/') ? `/comic/${serie.slug}` : this.absUrl(`/comic/${serie.slug}`),
      thumbnailUrl: (serie.urlImg ?? '').replace('http://', 'https://'),
      description: serie.sinopsis ?? undefined,
      genre: serie.genders?.map((g) => g.name).join(', ') || undefined,
      status,
      lang: this.lang,
    };
  }

  private chapterToChapter(dto: ChapterDto, mangaSlug: string): Chapter {
    const num = dto.num;
    const chapName = dto.name;
    const digitRegex = /\d/;
    const name =
      chapName && digitRegex.test(chapName)
        ? chapName
        : `Chapter ${num?.toString().replace('.0', '') ?? ''}`.trim();
    return {
      name,
      url: `/comic/${mangaSlug}/${dto.slug}`,
      chapterNumber: num ?? undefined,
      dateUpload: dto.createdAt ? new Date(dto.createdAt).getTime() : undefined,
    };
  }

  private parseStatus(raw?: string): Manga['status'] {
    if (!raw) return undefined;
    const s = raw.toLowerCase();
    if (s.includes('en emision') || s.includes('ongoing')) return 1;
    if (s.includes('completado') || s.includes('finalizado') || s.includes('completed')) return 0;
    if (s.includes('cancelado') || s.includes('cancelled')) return 3;
    if (s.includes('pausado') || s.includes('hiatus') || s.includes('paused')) return 2;
    return undefined;
  }

  private extractSlug(mangaUrl: string): string | null {
    try {
      const u = new URL(this.absUrl(mangaUrl));
      const parts = u.pathname.split('/').filter(Boolean);
      // /comic/<slug> or /en/comic/<slug>
      const idx = parts.indexOf('comic');
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
      return parts[parts.length - 1] ?? null;
    } catch {
      const parts = mangaUrl.split('/').filter(Boolean);
      const idx = parts.indexOf('comic');
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
      return parts[parts.length - 1] ?? null;
    }
  }

  private extractChapterParts(chapterUrl: string): { mangaSlug: string | null; chapterSlug: string | null } {
    try {
      const u = new URL(this.absUrl(chapterUrl));
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('comic');
      if (idx !== -1) {
        const mangaSlug = parts[idx + 1] ?? null;
        const chapterSlug = parts[idx + 2] ?? null;
        return { mangaSlug, chapterSlug };
      }
      return { mangaSlug: null, chapterSlug: null };
    } catch {
      const parts = chapterUrl.split('/').filter(Boolean);
      const idx = parts.indexOf('comic');
      if (idx !== -1) {
        return { mangaSlug: parts[idx + 1] ?? null, chapterSlug: parts[idx + 2] ?? null };
      }
      return { mangaSlug: null, chapterSlug: null };
    }
  }
}
