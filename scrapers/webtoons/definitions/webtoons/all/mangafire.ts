import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const BASE_URL = 'https://mangafire.to';
const LIMIT = 50;

const TABLE_1 = Buffer.from(
  'yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==',
  'base64'
);
const KEY_1 = Buffer.from('0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=', 'base64');
const TABLE_2 = Buffer.from(
  'IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==',
  'base64'
);
const KEY_2 = Buffer.from('AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==', 'base64');
const TABLE_3 = Buffer.from(
  'NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==',
  'base64'
);
const KEY_3 = Buffer.from('DELOJgPsVaCcblDtTGMdHzM=', 'base64');

interface ApiMetaDto {
  lastPage?: number;
  hasNext?: boolean;
}

interface ApiResponseDto<T> {
  items: T[];
  meta?: ApiMetaDto | null;
}

interface PosterDto {
  small?: string | null;
  medium?: string | null;
  large?: string | null;
}

interface MangaDto {
  hid: string;
  slug?: string | null;
  title: string;
  poster?: PosterDto | null;
}

interface EntityDto {
  title: string;
}

interface MangaDetailsDto {
  hid: string;
  slug?: string | null;
  title: string;
  type?: string | null;
  status?: string | null;
  poster?: PosterDto | null;
  synopsisHtml?: string | null;
  authors?: EntityDto[] | null;
  artists?: EntityDto[] | null;
  genres?: EntityDto[] | null;
  themes?: EntityDto[] | null;
}

interface MangaDetailsResponseDto {
  data: MangaDetailsDto;
}

interface ChapterDto {
  id: number;
  number: number;
  name?: string | null;
  createdAt?: number | null;
  type?: string | null;
}

interface PageDto {
  url: string;
}

interface PagesResponseDto {
  data: {
    pages: PageDto[];
  };
}

function encryptStage(data: Uint8Array, table: Uint8Array, key: Uint8Array, iv: number): Uint8Array {
  const out = Buffer.alloc(data.length);
  let prev = iv;
  const keySize = key.length;
  for (let i = 0; i < data.length; i++) {
    prev = table[(data[i] ^ key[i % keySize] ^ prev) & 0xff];
    out[i] = prev;
  }
  return out;
}

function signVrf(path: string): string {
  let data: Buffer = Buffer.from(path, 'utf-8');
  const stages: Array<{ table: Buffer; key: Buffer; iv: number }> = [
    { table: TABLE_1, key: KEY_1, iv: 0x5a },
    { table: TABLE_2, key: KEY_2, iv: 0x35 },
    { table: TABLE_3, key: KEY_3, iv: 0xba },
  ];
  for (const stage of stages) {
    data = Buffer.from(encryptStage(data, stage.table, stage.key, stage.iv));
  }
  return data.toString('base64url');
}

function sortedQueryString(path: string, params: URLSearchParams): string {
  const entries = Array.from(params.entries()).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  );
  if (entries.length === 0) return path;
  return `${path}?${entries.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

function getHid(url: string): string {
  const lastPart = url.replace(/\/+$/, '').split('/').pop() ?? '';
  if (lastPart.includes('.')) return lastPart.split('.').pop() ?? lastPart;
  if (lastPart.includes('-')) return lastPart.split('-')[0];
  return lastPart;
}

function formatChapterNumber(number: number): string {
  return number.toString().replace(/\.0+$/, '');
}

export class MangafireScraper extends BaseScraper {
  readonly name = 'MangaFire';
  readonly baseUrl = BASE_URL;
  readonly lang = 'all';

  private async apiGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) searchParams.set(k, v);
    const signedPath = sortedQueryString(path.replace(/^\/api/, ''), searchParams);
    searchParams.set('vrf', signVrf(signedPath));
    url.search = searchParams.toString();
    const res = await this.get(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    return res.data;
  }

  private toManga(item: MangaDto): Manga {
    const poster = item.poster;
    return {
      title: item.title,
      url: `/title/${item.hid}${item.slug ? `-${item.slug}` : ''}`,
      thumbnailUrl: poster?.large ?? poster?.medium ?? poster?.small ?? '',
      lang: this.lang,
    };
  }

  private parseMangaList(data: ApiResponseDto<MangaDto>): SearchResult {
    return {
      mangas: (data.items ?? []).map(item => this.toManga(item)),
      hasNextPage: data.meta?.hasNext ?? false,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const data = (await this.apiGet('/api/titles', {
      'order[views_30d]': 'desc',
      page: page.toString(),
      limit: LIMIT.toString(),
    })) as ApiResponseDto<MangaDto>;
    return this.parseMangaList(data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const data = (await this.apiGet('/api/titles', {
      'order[chapter_updated_at]': 'desc',
      page: page.toString(),
      limit: LIMIT.toString(),
    })) as ApiResponseDto<MangaDto>;
    return this.parseMangaList(data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params: Record<string, string> = {
      page: page.toString(),
      limit: LIMIT.toString(),
    };
    const trimmed = query.trim();
    if (trimmed) params.keyword = trimmed;
    const data = (await this.apiGet('/api/titles', params)) as ApiResponseDto<MangaDto>;
    return this.parseMangaList(data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const hid = getHid(mangaUrl);
    const data = (await this.apiGet(`/api/titles/${hid}`)) as MangaDetailsResponseDto;
    const d = data.data;
    let status: MangaStatus;
    switch (d.status?.toLowerCase()) {
      case 'releasing':
        status = 1;
        break;
      case 'finished':
        status = 0;
        break;
      case 'on_hiatus':
        status = 2;
        break;
      case 'discontinued':
        status = 2;
        break;
      default:
        status = undefined;
    }
    const genreParts: string[] = [];
    if (d.type) genreParts.push(d.type.charAt(0).toUpperCase() + d.type.slice(1));
    if (d.genres) genreParts.push(...d.genres.map(g => g.title));
    if (d.themes) genreParts.push(...d.themes.map(g => g.title));
    const poster = d.poster;
    const description = d.synopsisHtml
      ? d.synopsisHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : undefined;
    return {
      title: d.title,
      url: mangaUrl,
      thumbnailUrl: poster?.large ?? poster?.medium ?? poster?.small ?? '',
      author: d.authors?.map(a => a.title).join(', ') || undefined,
      artist: d.artists?.map(a => a.title).join(', ') || undefined,
      description: description || undefined,
      genre: genreParts.join(', ') || undefined,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const hid = getHid(mangaUrl);
    const chapters: Chapter[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const data = (await this.apiGet(`/api/titles/${hid}/chapters`, {
        language: 'en',
        sort: 'number',
        order: 'desc',
        page: page.toString(),
        limit: '200',
      })) as ApiResponseDto<ChapterDto>;
      const items = data.items ?? [];
      for (const ch of items) {
        const name = `Ch. ${formatChapterNumber(ch.number)}${
          ch.name ? ` - ${ch.name}` : ''
        }`;
        chapters.push({
          name,
          url: `${mangaUrl}/${ch.id}-chapter-${formatChapterNumber(ch.number)}-en`,
          chapterNumber: ch.number,
          scanlator: ch.type ?? 'Unknown',
          dateUpload: ch.createdAt ? ch.createdAt * 1000 : undefined,
        });
      }
      lastPage = data.meta?.lastPage ?? 1;
      page++;
    } while (page <= lastPage);
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const segments = chapterUrl.split('/').filter(Boolean);
    const last = segments.pop() ?? '';
    const path = segments.includes('volume')
      ? `/api/volumes/${last}`
      : `/api/chapters/${last.split('-')[0]}`;
    const data = (await this.apiGet(path)) as PagesResponseDto;
    return (data.data?.pages ?? []).map((p, index) => ({ index, imageUrl: p.url }));
  }
}
