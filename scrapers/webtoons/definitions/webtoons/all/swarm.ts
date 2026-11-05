import crypto from 'crypto';
import { BaseScraper } from '../../../engine/base';
import { extractNextJsRsc, isJsonObject } from '../../../engine/nextjs';
import type { Json } from '../../../engine/nextjs';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface SwarmMangaDto {
  title?: string;
  url?: string;
  link?: string;
  cover?: string | null;
  covers?: string[];
  description?: string | null;
  genres?: string[];
  tags?: string[];
  author?: string | null;
  authors?: string[];
  artist?: string | null;
  artists?: string[];
  status?: string | null;
  type?: string | null;
  year?: number | null;
}

interface SwarmChapterDto {
  id: string;
  lang?: string;
  number?: string;
  rank?: string | null;
  published_date?: string | null;
  source_name?: string | null;
  source?: string | null;
  scan_group?: string | null;
}

interface SwarmComicPageDto {
  manga?: SwarmMangaDto;
  chapters?: SwarmChapterDto[];
}

interface SwarmPagesResponse {
  chapter?: {
    data?: string[];
  };
}

const PAYLOAD_SECRET = 'e3bca6f9a7e64e369ddc450bb7ff295b3d78e7d4fcb148c10d10ae9385476a5f';
const ENCRYPT_KEY = crypto.createHash('sha256').update(PAYLOAD_SECRET).digest();

function formatCoverUrl(baseUrl: string, cover?: string | null): string {
  if (!cover) return '';
  try {
    const u = new URL(cover);
    if (u.host === 'cum.swarm.ws') {
      return `${baseUrl}/covers${u.pathname}`;
    }
    return `${baseUrl}/api/image-proxy?url=${encodeURIComponent(cover)}`;
  } catch {
    return cover;
  }
}

function parseStatus(status?: string | null): MangaStatus {
  switch (status?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'cancelled':
    case 'canceled':
    case 'discontinued': return 2;
    default: return 3;
  }
}

function extractSlug(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const comicIdx = parts.indexOf('comic');
    if (comicIdx !== -1 && parts[comicIdx + 1]) {
      return parts[comicIdx + 1];
    }
    return parts[parts.length - 1] ?? url;
  } catch {
    return url.replace(/^.*\/comic\//, '').replace(/[/?#].*$/, '');
  }
}

export class SwarmScraper extends BaseScraper {
  override readonly name = 'Swarm';
  override readonly baseUrl = 'https://swarm.ws';
  override readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    const limit = 24;
    const offset = (page - 1) * limit;
    const url = `${this.baseUrl}/api/analytics/popular?window=7d&limit=${limit}&offset=${offset}`;
    const res = await this.get(url, {
      headers: {
        Accept: 'application/json',
        Referer: `${this.baseUrl}/`,
      },
    });
    const body = res.data as { data?: SwarmMangaDto[]; total?: number };
    const mangas = (body.data ?? []).map(item => this.itemToManga(item));
    return {
      mangas,
      hasNextPage: (body.total ?? 0) > offset + mangas.length,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/api/latest?limit=50&filter=new&page=${page}`;
    const res = await this.get(url, {
      headers: {
        Accept: 'application/json',
        Referer: `${this.baseUrl}/`,
      },
    });
    const body = res.data as { data?: SwarmMangaDto[]; hasMore?: boolean };
    const mangas = (body.data ?? []).map(item => this.itemToManga(item));
    return {
      mangas,
      hasNextPage: Boolean(body.hasMore),
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    const limit = 24;
    const offset = (page - 1) * limit;
    const url = trimmed
      ? `${this.baseUrl}/api/comic/search?title=${encodeURIComponent(trimmed)}&limit=${limit}&offset=${offset}`
      : `${this.baseUrl}/api/manga/filtered?limit=${limit}&offset=${offset}`;

    const res = await this.get(url, {
      headers: {
        Accept: 'application/json',
        Referer: `${this.baseUrl}/`,
      },
    });
    const body = res.data as { data?: SwarmMangaDto[]; total?: number };
    const mangas = (body.data ?? []).map(item => this.itemToManga(item));
    return {
      mangas,
      hasNextPage: (body.total ?? 0) > offset + mangas.length,
    };
  }

  private itemToManga(item: SwarmMangaDto): Manga {
    const slug = item.url ?? item.link ?? '';
    const cover = item.covers?.[0] ?? item.cover;
    return {
      title: item.title ?? '',
      url: `${this.baseUrl}/comic/${slug}`,
      thumbnailUrl: formatCoverUrl(this.baseUrl, cover),
      lang: this.lang,
    };
  }

  private async fetchComicPage(slug: string): Promise<SwarmComicPageDto | null> {
    const url = `${this.baseUrl}/comic/${slug}?_rsc=`;
    const res = await this.get(url, {
      headers: {
        rsc: '1',
        Accept: 'text/x-component',
      },
    });
    const data = extractNextJsRsc(String(res.data), (v: Json) => {
      return isJsonObject(v) && 'manga' in v && 'chapters' in v;
    });
    return data && isJsonObject(data) ? (data as unknown as SwarmComicPageDto) : null;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = extractSlug(mangaUrl);
    const page = await this.fetchComicPage(slug);
    if (!page?.manga) return {};

    const m = page.manga;
    const author = m.authors?.join(', ') || m.author || undefined;
    const artist = m.artists?.join(', ') || m.artist || undefined;
    const genres = [
      m.type,
      ...(m.genres ?? []),
      ...(m.tags ?? []),
    ].filter((value): value is string => Boolean(value));

    const cover = m.covers?.[0] ?? m.cover;

    return {
      title: m.title ?? '',
      url: `${this.baseUrl}/comic/${slug}`,
      thumbnailUrl: formatCoverUrl(this.baseUrl, cover),
      lang: this.lang,
      author,
      artist,
      status: parseStatus(m.status),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: m.description || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = extractSlug(mangaUrl);
    const page = await this.fetchComicPage(slug);
    if (!page?.chapters) return [];

    let rawChapters = page.chapters;
    // Prefer english chapters if present
    const enChapters = rawChapters.filter(c => c.lang === 'en');
    if (enChapters.length > 0) {
      rawChapters = enChapters;
    }

    return rawChapters.map(c => {
      const num = Number.parseFloat(c.number ?? '');
      const parsedDate = c.published_date ? new Date(c.published_date).getTime() : NaN;
      const uploader = c.source_name ?? c.source ?? c.scan_group ?? 'swarmws';
      const rankParam = c.rank && c.rank !== 'a' ? `&rank=${encodeURIComponent(c.rank)}` : '';
      return {
        name: `Chapter ${c.number ?? ''}`,
        url: `${this.baseUrl}/comic/${slug}/chapter/${c.number ?? ''}?id=${encodeURIComponent(c.id)}${rankParam}`,
        chapterNumber: Number.isFinite(num) ? num : undefined,
        scanlator: uploader,
        dateUpload: Number.isFinite(parsedDate) ? parsedDate : undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    let chapterId = '';
    try {
      const u = new URL(chapterUrl);
      chapterId = u.searchParams.get('id') ?? '';
    } catch {
      // fallback
    }

    if (!chapterId) {
      chapterId = chapterUrl.split('/').pop()?.split('?')[0] ?? '';
    }

    const payload = this.encryptPayload(JSON.stringify({ chapterId }));
    const res = await this.post(`${this.baseUrl}/api/sp`, JSON.stringify({ payload }), {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: chapterUrl,
      },
    });

    const body = res.data as SwarmPagesResponse;
    const images = (body.chapter?.data ?? []).filter(img => !img.endsWith('/noah/fall.png'));
    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }

  private encryptPayload(jsonStr: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPT_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }
}
