// ============================================================
// engine/vinetheme.ts — Équivalent TS de vinetheme multisrc (Diva Scans etc.)
// ============================================================

import axios, { AxiosInstance } from 'axios';
import { BaseScraper } from './base';
import { extractNextJs } from './nextjs';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface MetaDto {
  name?: string;
  rating?: number;
  status?: string;
  type?: string;
  origin?: string;
  isHot?: boolean;
  isMature?: boolean;
  salePercent?: number;
}

interface MangaDto extends MetaDto {
  id: string;
  title: string;
  coverImage?: string;
  slug?: string;
  originalTitle?: string;
  aliases?: string[];
  description?: string;
  genres?: Array<{ name?: string; genre?: { slug?: string } | null; displayName?: string }>;
  team?: { name?: string } | null;
}

interface ChapterDto {
  id: string;
  number: number;
  title?: string | null;
  publishedAt?: string;
  isLocked?: boolean;
}

interface DetailDto {
  series: MangaDto;
  chapters: ChapterDto[];
}

interface ChapterPagesDto {
  chapter: {
    pages?: Array<{ imageUrl?: string | null }>;
  };
}

function vstatus(s: string | undefined): MangaStatus {
  switch (s) {
    case 'ONGOING': return 1;
    case 'COMPLETED': return 0;
    case 'CANCELLED': return 2;
    case 'HIATUS': return 3;
    default: return 3;
  }
}

function stripEmoji(s: string): string {
  return s.replace(/[^\p{L}\p{N}\- ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export abstract class VineThemeScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang = 'en';

  constructor(name: string, baseUrl: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private readonly api: AxiosInstance = axios.create({
    timeout: 30_000,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    },
  });

  private rscHeaders(): Record<string, string> {
    return { rsc: '1' };
  }

  private async rscGet(pathOrUrl: string): Promise<string> {
    const res = await this.api.get(pathOrUrl, { headers: this.rscHeaders() });
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }

  private toManga(m: MangaDto): Manga {
    const genres: string[] = [];
    if (m.type) genres.push(m.type);
    if (m.origin) genres.push(m.origin);
    if (m.isMature) genres.push('Mature');
    for (const g of m.genres || []) {
      const name = g.name || g.displayName || g.genre?.slug || '';
      if (name) genres.push(stripEmoji(name));
    }

    const info: string[] = [];
    if (m.rating && m.rating > 0) info.push(`Rating: ${m.rating}`);
    if (m.type) info.push(`Type: ${m.type}`);
    if (m.origin) info.push(`Origin: ${m.origin}`);
    if (m.isHot) info.push('Featured');
    if (m.isMature) info.push('Mature');
    if (m.salePercent && m.salePercent > 0) info.push(`Sale: ${m.salePercent}%`);

    const altTitles = [m.originalTitle, ...(m.aliases || [])]
      .filter((t): t is string => !!t)
      .map((t: string) => t.trim())
      .filter(t => t && !t.toLowerCase().includes(m.title.toLowerCase()));

    let description = m.description || '';
    if (info.length) description = description ? `${description}\n\n${info.join('\n')}` : info.join('\n');
    if (altTitles.length) {
      const altBlock = `Alternative titles:\n${altTitles.map(t => `- ${t}`).join('\n')}`;
      description = description ? `${description}\n\n${altBlock}` : altBlock;
    }

    return {
      title: m.title,
      url: `/series/comic/${m.slug || ''}`,
      thumbnailUrl: this.absUrl(m.coverImage || ''),
      author: m.team?.name || undefined,
      status: vstatus(m.status),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: description || undefined,
      lang: this.lang,
    };
  }

  private async fetchDetail(slug: string): Promise<DetailDto | null> {
    const body = await this.rscGet(`${this.baseUrl}/series/comic/${slug}?sort=desc`);
    return extractNextJs(
      body,
      (el: unknown) =>
        !!el && typeof el === 'object' && !Array.isArray(el) &&
        'series' in el && 'chapters' in el,
    ) as DetailDto | null;
  }

  private async apiSeries(params: Record<string, string>): Promise<SearchResult> {
    const qs = new URLSearchParams(params).toString();
    const res = await this.api.get(`${this.baseUrl}/api/series?${qs}`);
    const data = res.data as { data?: MangaDto[]; meta?: { hasMore?: boolean } };
    return {
      mangas: (data.data || []).map(m => this.toManga(m)),
      hasNextPage: data.meta?.hasMore === true,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.apiSeries({ sort: 'popular', contentMode: 'comics', page: String(page), limit: '24' });
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.apiSeries({ sort: 'updated', contentMode: 'comics', page: String(page), limit: '24' });
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params: Record<string, string> = { limit: '24', contentMode: 'comics', page: String(page) };
    if (query) params.q = query;
    return this.apiSeries(params);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.replace(/\/$/, '').split('/').pop() || '';
    const detail = await this.fetchDetail(slug);
    if (!detail) throw new Error('Impossible to extract manga details');
    return this.toManga(detail.series);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace(/\/$/, '').split('/').pop() || '';
    const detail = await this.fetchDetail(slug);
    if (!detail) throw new Error('Impossible to extract chapter list');

    return (detail.chapters || [])
      .filter(ch => !ch.isLocked)
      .map(ch => {
        const numberString = `${ch.number}`.replace(/\.0$/, '');
        let name: string;
        if (ch.title && ch.title !== numberString && ch.title.trim()) {
          name = ch.title;
        } else {
          name = `Chapter ${numberString}`;
        }
        return {
          name,
          url: `${this.baseUrl}/series/comic/${slug}/chapter/${numberString}`,
          chapterNumber: ch.number,
          dateUpload: ch.publishedAt ? new Date(ch.publishedAt).getTime() : undefined,
        };
      });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const body = await this.rscGet(chapterUrl.split('#')[0]);
    const dto = extractNextJs(
      body,
      (el: unknown) => !!el && typeof el === 'object' && !Array.isArray(el) && 'chapter' in el,
    ) as ChapterPagesDto | null;

    const pages = (dto?.chapter?.pages || [])
      .filter(p => !!p.imageUrl)
      .map((p, index) => ({ index, imageUrl: this.absUrl(p.imageUrl as string) }));

    if (pages.length === 0) {
      throw new Error('This chapter is locked and requires coins to read');
    }
    return pages;
  }
}