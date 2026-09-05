import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const parseJson = (d: unknown): Record<string, unknown> => {
  if (typeof d === 'string') {
    try { return JSON.parse(d) as Record<string, unknown>; } catch { return {}; }
  }
  return (d as Record<string, unknown>) ?? {};
};

type SeriesDto = {
  title: string;
  slug: string;
  coverUrl?: string | null;
  description?: string | null;
  publicationStatus?: string | null;
  author?: string | null;
  artist?: string | null;
  genres?: string[] | null;
};

type PaginationDto = {
  page?: number;
  totalPages?: number;
};

const GENRES: Array<{ name: string; slug: string }> = [
  { name: 'Action', slug: 'action' },
  { name: 'Adaptation', slug: 'adaptation' },
  { name: 'Adult', slug: 'adult' },
  { name: 'Adventure', slug: 'adventure' },
  { name: 'Comedy', slug: 'comedy' },
  { name: 'Demons', slug: 'demons' },
  { name: 'Drama', slug: 'drama' },
  { name: 'Ecchi', slug: 'ecchi' },
  { name: 'Fantasy', slug: 'fantasy' },
  { name: 'Gender Bender', slug: 'genderbender' },
  { name: 'Gore', slug: 'gore' },
  { name: 'Harem', slug: 'harem' },
  { name: 'Historical', slug: 'historical' },
  { name: 'Horror', slug: 'horror' },
  { name: 'Isekai', slug: 'isekai' },
  { name: 'Josei', slug: 'josei' },
  { name: 'Magic', slug: 'magic' },
  { name: 'Martial Arts', slug: 'martialarts' },
  { name: 'Mature', slug: 'mature' },
  { name: 'Mecha', slug: 'mecha' },
  { name: 'Military', slug: 'military' },
  { name: 'Monsters', slug: 'monsters' },
  { name: 'Mystery', slug: 'mystery' },
  { name: 'Post-Apocalyptic', slug: 'post-apocalyptic' },
  { name: 'Psychological', slug: 'psychological' },
  { name: 'Romance', slug: 'romance' },
  { name: 'School Life', slug: 'schoollife' },
  { name: 'Sci-Fi', slug: 'sci-fi' },
  { name: 'Seinen', slug: 'seinen' },
  { name: 'Shoujo', slug: 'shoujo' },
  { name: 'Shoujo Ai', slug: 'shoujoai' },
  { name: 'Shounen', slug: 'shounen' },
  { name: 'Shounen Ai', slug: 'shounenai' },
  { name: 'Slice of Life', slug: 'sliceoflife' },
  { name: 'Smut', slug: 'smut' },
  { name: 'Sports', slug: 'sports' },
  { name: 'Supernatural', slug: 'supernatural' },
  { name: 'Thriller', slug: 'thriller' },
  { name: 'Tragedy', slug: 'tragedy' },
  { name: 'Video Games', slug: 'video-games' },
  { name: 'Webtoons', slug: 'webtoons' },
  { name: 'Wuxia', slug: 'wuxia' },
  { name: 'Yaoi', slug: 'yaoi' },
  { name: 'Yuri', slug: 'yuri' },
];

function genreLabel(slug: string): string {
  const found = GENRES.find(g => g.slug.toLowerCase() === slug.toLowerCase());
  if (found) return found.name;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function findGenre(query: string): { name: string; slug: string } | undefined {
  const normalized = query.replace(/-/g, '').replace(/ /g, '').toLowerCase();
  return GENRES.find(g =>
    g.name.toLowerCase() === query.toLowerCase() ||
    g.slug.toLowerCase() === query.toLowerCase() ||
    g.name.replace(/-/g, '').replace(/ /g, '').toLowerCase() === normalized,
  );
}

export class StoneScapeScraper extends BaseScraper {
  readonly name = 'StoneScape';
  readonly baseUrl = 'https://stonescape.xyz';
  readonly lang = 'en';
  private readonly apiUrl = `${this.baseUrl}/api`;

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/series/popular?page=${page}&period=week&contentType=manhwa&limit=24`, {
      headers: { Origin: this.baseUrl },
    });
    const data = parseJson(res.data);
    const list = (data['data'] as SeriesDto[]) ?? [];
    const pagination = data['pagination'] as PaginationDto | undefined;
    const mangas: Manga[] = list.map(item => ({
      title: item.title || '',
      url: `/series/${item.slug}`,
      thumbnailUrl: item.coverUrl ? this.absUrl(item.coverUrl) : '',
      lang: this.lang,
    }));
    const hasNextPage = (pagination?.page ?? 1) < (pagination?.totalPages ?? 1);
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/series?page=${page}&limit=24&contentType=manhwa`, {
      headers: { Origin: this.baseUrl },
    });
    const data = parseJson(res.data);
    // API returns { data: [...], pagination: {...} } same as popular
    const list = (data['data'] as SeriesDto[]) ?? [];
    const pagination = data['pagination'] as PaginationDto | undefined;
    const mangas: Manga[] = list.map(item => ({
      title: item.title || '',
      url: `/series/${item.slug}`,
      thumbnailUrl: item.coverUrl ? this.absUrl(item.coverUrl) : '',
      lang: this.lang,
    }));
    const hasNextPage = (pagination?.page ?? 1) < (pagination?.totalPages ?? 1);
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    // Direct URL handling: if query is a full stonescape series URL, fetch single result
    if (trimmed.startsWith('https://')) {
      try {
        const url = new URL(trimmed);
        if (url.host === new URL(this.baseUrl).host) {
          const idx = url.pathname.split('/').indexOf('series');
          if (idx !== -1 && idx + 1 < url.pathname.split('/').length) {
            const slug = url.pathname.split('/').filter(Boolean)[idx + 1];
            const res = await this.get(`${this.apiUrl}/series/by-slug/${slug}`, { headers: { Origin: this.baseUrl } });
            const dto = parseJson(res.data) as unknown as SeriesDto;
            if (dto.slug) {
              return {
                mangas: [{ title: dto.title, url: `/series/${dto.slug}`, thumbnailUrl: dto.coverUrl ? this.absUrl(dto.coverUrl) : '', lang: this.lang }],
                hasNextPage: false,
              };
            }
          }
        }
      } catch {
        // fall through
      }
    }

    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '24');
    params.set('contentType', 'manhwa');

    const matchedGenre = trimmed ? findGenre(trimmed) : undefined;
    if (matchedGenre) {
      params.set('genres', matchedGenre.slug);
    } else if (trimmed) {
      params.set('search', trimmed);
    }

    const res = await this.get(`${this.apiUrl}/series?${params.toString()}`, {
      headers: { Origin: this.baseUrl },
    });
    const data = parseJson(res.data);
    // Handle single by-slug response wrapped vs list
    if (data['slug'] && data['title']) {
      const dto = data as unknown as SeriesDto;
      return {
        mangas: [{ title: dto.title, url: `/series/${dto.slug}`, thumbnailUrl: dto.coverUrl ? this.absUrl(dto.coverUrl) : '', lang: this.lang }],
        hasNextPage: false,
      };
    }
    const list = (data['data'] as SeriesDto[]) ?? [];
    const pagination = data['pagination'] as PaginationDto | undefined;
    const mangas: Manga[] = list.map(item => ({
      title: item.title || '',
      url: `/series/${item.slug}`,
      thumbnailUrl: item.coverUrl ? this.absUrl(item.coverUrl) : '',
      lang: this.lang,
    }));
    const hasNextPage = (pagination?.page ?? 1) < (pagination?.totalPages ?? 1);
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() || '';
    const res = await this.get(`${this.apiUrl}/series/by-slug/${slug}`, {
      headers: { Origin: this.baseUrl },
    });
    const data = parseJson(res.data) as unknown as SeriesDto & { title?: string; name?: string; coverUrl?: string; cover?: string };
    const title = (data as Record<string, unknown>)['title'] as string || (data as Record<string, unknown>)['name'] as string || '';
    const cover = (data.coverUrl as string | undefined) || (data as Record<string, unknown>)['cover'] as string | undefined || '';
    const descriptionRaw = (data.description as string | undefined) || '';
    const description = descriptionRaw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
    const statusRaw = (data.publicationStatus as string | undefined)?.toLowerCase();
    let status: Manga['status'];
    switch (statusRaw) {
      case 'ongoing': status = 1; break;
      case 'completed': status = 0; break;
      case 'hiatus': status = 2; break;
      case 'dropped':
      case 'cancelled': status = 2; break;
      default: status = undefined;
    }
    const genre = (data.genres ?? []).map(g => genreLabel(g)).join(', ') || undefined;
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: cover ? this.absUrl(cover) : '',
      description,
      author: (data.author as string | undefined) || undefined,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop() || '';
    const res = await this.get(`${this.apiUrl}/series/by-slug/${slug}/chapters`, {
      headers: { Origin: this.baseUrl },
    });
    const data = parseJson(res.data);
    const chapters = (data['chapters'] as Array<{ chapterId: string; chapterNumber: string; title?: string; createdAt?: string }>) ?? [];
    return chapters.map(ch => {
      const formatted = parseFloat(ch.chapterNumber).toString();
      const num = isNaN(parseFloat(formatted)) ? ch.chapterNumber : formatted.replace(/\.0$/, '');
      return {
        name: `Chapter ${num}${ch.title ? ` - ${ch.title}` : ''}`,
        url: `/series/${slug}/ch-${num}#${ch.chapterId}`,
        chapterNumber: parseFloat(ch.chapterNumber) || undefined,
        dateUpload: ch.createdAt ? new Date(ch.createdAt).getTime() : undefined,
      };
    }).reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const hashIdx = chapterUrl.indexOf('#');
    const chapterId = hashIdx >= 0 ? chapterUrl.slice(hashIdx + 1) : chapterUrl.split('/').pop() || '';
    const res = await this.get(`${this.apiUrl}/chapters/${chapterId}/pages`, {
      headers: { Origin: this.baseUrl },
    });
    const data = parseJson(res.data);
    const pages = (data['allPages'] as Array<{ pageNumber?: number; url?: string; imageUrl?: string }>)
      ?? (data['pages'] as Array<{ url?: string }>)
      ?? (data['data'] as Array<{ url?: string }>)
      ?? [];
    return (Array.isArray(pages) ? pages : []).map((p, index) => ({
      index: p.pageNumber ? p.pageNumber - 1 : index,
      imageUrl: this.absUrl((p as Record<string, string>)['url'] || (p as Record<string, string>)['imageUrl'] || ''),
    })).filter(p => p.imageUrl);
  }
}
