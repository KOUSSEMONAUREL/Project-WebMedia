import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Port de l'extension keiyoushi `en/philiascans`.
 *
 * PhiliaScans expose une API JSON nette sur son propre domaine, sans signature
 * ni cle : `/api/manga` pour le catalogue pagine et la recherche, `/api/manga/<slug>`
 * pour le detail, `/api/manga/<slug>/chapters` pour les chapitres.
 *
 * Une premiere version de ce port regex-scrapait le HTML racine, slug-titlecase
 * les noms, laissait toujours `thumbnailUrl` vide et ne knew pas paginer — donc
 * une recherche sur `doesn't` ou `maiden's` renvoyait 0 alors que l'API en trouve.
 * L'API les repond directement via le parametre `q`.
 */
const API = 'https://philiascans.org/api';

type MangaItem = {
  slug?: string;
  title?: string;
  coverImageUrl?: string;
  status?: string;
  synopsis?: string;
  year?: number;
  type?: string;
  chapterCount?: number;
  genres?: { slug: string; name: string }[];
};

type ChapterItem = {
  number?: string;
  title?: string | null;
  slug?: string;
  publishedAt?: string;
  coinPrice?: number;
};

export class PhiliaScansScraper extends BaseScraper {
  readonly name = 'Philia Scans';
  readonly baseUrl = 'https://philiascans.org';
  readonly lang = 'en';

  private slugFrom(url: string): string {
    const m = url.match(/\/manga\/([^/?#]+)/);
    if (m) return m[1];
    return url.split('#')[1]?.split('/')[0] ?? url.split('/').filter(Boolean).pop() ?? '';
  }

  private resolveUrl(value: string | undefined): string {
    if (!value) return '';
    try {
      return new URL(value, `${this.baseUrl}/`).toString();
    } catch {
      return value;
    }
  }

  private mapItems(items: MangaItem[]): Manga[] {
    return items
      .filter((m) => typeof m.slug === 'string' && m.slug.length > 0)
      .map((m) => ({
        title: m.title ?? '',
        url: `${this.baseUrl}/manga/${m.slug}`,
        thumbnailUrl: this.resolveUrl(m.coverImageUrl),
        lang: this.lang,
      }));
  }

  private async list(params: Record<string, string>): Promise<{ items: Manga[]; total: number; totalPages: number }> {
    const res = await this.get(`${API}/manga?${new URLSearchParams(params).toString()}`, {
      headers: { Accept: 'application/json', Referer: `${this.baseUrl}/` },
    });
    const raw = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    return {
      items: this.mapItems((raw?.items ?? []) as MangaItem[]),
      total: raw?.total ?? 0,
      totalPages: raw?.totalPages ?? 1,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const { items, totalPages } = await this.list({ page: String(page) });
    return { mangas: items, hasNextPage: page < totalPages };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const { items, totalPages } = await this.list({ page: String(page) });
    return { mangas: items, hasNextPage: page < totalPages };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const { items, totalPages } = await this.list({ page: String(page), q: query });
    return { mangas: items, hasNextPage: page < totalPages };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`${API}/manga/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json', Referer: `${this.baseUrl}/` },
    });
    const raw = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const m = (raw?.item ?? raw?.data ?? raw) as MangaItem;
    const synopsis = (m.synopsis ?? '').replace(/<[^>]*>/g, '').trim();
    return {
      title: m.title ?? '',
      url: `${this.baseUrl}/manga/${slug}`,
      thumbnailUrl: this.resolveUrl(m.coverImageUrl),
      description: synopsis || undefined,
      status: m.status === 'ON_GOING' ? 1 : m.status === 'COMPLETED' ? 0 : 3,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`${API}/manga/${encodeURIComponent(slug)}/chapters`, {
      headers: { Accept: 'application/json', Referer: `${this.baseUrl}/` },
    });
    const raw = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const chapters = (raw?.items ?? raw?.chapters ?? []) as ChapterItem[];

    return chapters.map((c) => {
      const num = Number.parseFloat(c.number ?? '');
      const label = c.title ? `${c.number ?? ''} — ${c.title}` : c.number ?? '';
      const published = c.publishedAt ? Date.parse(c.publishedAt) : NaN;
      return {
        name: label || `Chapter ${c.slug ?? ''}`,
        url: `${this.baseUrl}/manga/${slug}/chapter/${c.slug ?? ''}`,
        chapterNumber: Number.isNaN(num) ? undefined : num,
        dateUpload: Number.isNaN(published) ? undefined : published,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    // Les scans sont servis par le lecteur heberge ; leurs URLs ne sont pas
    // derivables de l'API JSON sans passer par la lecture de la page.
    return [];
  }
}