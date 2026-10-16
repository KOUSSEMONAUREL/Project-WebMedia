import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Port de l'extension keiyoushi `en/omegascans` (HeanCms).
 *
 * Le catalogue est une API JSON sur `api.omegascans.org`, et non le HTML du site :
 * `/query` pour la liste paginee, `/series/<slug>` pour le detail,
 * `/chapter/query?series_id=<id>` pour les chapitres. Scraper le HTML racine
 * donnerait des titres fabriques a partir des slugs (`Im A Vampire` au lieu du
 * vrai `I'm a Vampire`), aucune pagination, et une recherche sur des titres
 * abimes — c'est ce que faisait une premiere version de ce port.
 *
 * L'API ne propose pas de recherche serveur : `/query` ignore `q`, `search`,
 * `title` et `keyword`. La recherche est donc made in client sur le catalogue
 * pagine, ce qui reste correct tant qu'on reste sur les vrais titres.
 */
const API = 'https://api.omegascans.org';

type Meta = {
  total?: number;
  per_page?: number;
  current_page?: number;
  last_page?: number;
};

type SeriesItem = {
  id?: number;
  title?: string;
  series_slug?: string;
  thumbnail?: string;
  status?: string;
  description?: string;
  series_type?: string;
};

type ChapterItem = {
  id?: number;
  chapter_name?: string;
  chapter_title?: string;
  chapter_slug?: string;
  created_at?: string;
  price?: number;
  meta?: { continuation?: unknown };
};

export class OmegaScansScraper extends BaseScraper {
  readonly name = 'Omega Scans';
  readonly baseUrl = 'https://omegascans.org';
  readonly apiUrl = API;
  readonly lang = 'en';

  private slugFrom(url: string): string {
    const m = url.match(/\/series\/([^/?#]+)/);
    if (m) return m[1];
    // le slug peut aussi etre la derniere partie apres un diese
    return url.split('#')[1]?.split('/')[0] ?? url.split('/').filter(Boolean).pop() ?? '';
  }

  private seriesIdFrom(url: string): string {
    const m = url.match(/series_id=(\d+)/);
    return m ? m[1] : '';
  }

  private mapSeries(items: SeriesItem[]): Manga[] {
    return items
      .filter((s) => typeof s.series_slug === 'string' && s.series_slug.length > 0)
      .map((s) => ({
        title: s.title ?? '',
        url: `${this.baseUrl}/series/${s.series_slug}`,
        thumbnailUrl: s.thumbnail ?? '',
        lang: this.lang,
      }));
  }

  private async query(page: number, extra: Record<string, string> = {}): Promise<{ items: Manga[]; meta: Meta }> {
    const params = new URLSearchParams({ page: String(page), limit: '25', ...extra });
    const res = await this.get(`${API}/query?${params.toString()}`, {
      headers: { Accept: 'application/json', Referer: `${this.baseUrl}/` },
    });
    const raw = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const items = (raw?.data ?? []) as SeriesItem[];
    return { items: this.mapSeries(items), meta: (raw?.meta ?? {}) as Meta };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const { items, meta } = await this.query(page);
    const last = meta.last_page ?? meta.current_page ?? 1;
    return { mangas: items, hasNextPage: page < last };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const { items, meta } = await this.query(page);
    const last = meta.last_page ?? meta.current_page ?? 1;
    return { mangas: items, hasNextPage: page < last };
  }

  /**
   * L'API n'expose pas de filtre par titre : `/query` renvoie la meme page quel
   * que soit `q`. On parcourt donc le catalogue pagine et on filtre sur le
   * titre reel, ce qui evite les faux negatifs du HTML.
   */
  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const needle = query.trim().toLowerCase();
    if (!needle) return { mangas: [], hasNextPage: false };

    const collected: Manga[] = [];
    let lastPage = 1;
    for (let p = 1; p <= 5 && collected.length < 25; p++) {
      const { items, meta } = await this.query(p);
      lastPage = meta.last_page ?? lastPage;
      for (const m of items) {
        if (m.title.toLowerCase().includes(needle)) collected.push(m);
      }
      if (p >= (meta.last_page ?? 1)) break;
    }

    return { mangas: collected.slice(0, 25), hasNextPage: page * 25 < lastPage * 12 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`${API}/series/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json', Referer: `${this.baseUrl}/` },
    });
    const raw = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const s = (raw?.data ?? raw) as SeriesItem & { author?: unknown; release_year?: number };
    const description = (s.description ?? '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim();
    const author = typeof s.author === 'string' ? s.author : undefined;
    return {
      title: s.title ?? '',
      url: `${this.baseUrl}/series/${slug}`,
      thumbnailUrl: s.thumbnail ?? '',
      description: description || undefined,
      author,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`${API}/series/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json', Referer: `${this.baseUrl}/` },
    });
    const raw = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const seriesId = (raw?.id ?? (raw?.data?.id as number | undefined)) as number | undefined;

    const chaptersRes = await this.get(
      `${API}/chapter/query?page=1&perPage=10000&series_id=${seriesId ?? ''}`,
      { headers: { Accept: 'application/json', Referer: `${this.baseUrl}/` } },
    );
    const chaptersRaw = typeof chaptersRes.data === 'string' ? JSON.parse(chaptersRes.data) : chaptersRes.data;
    const chapters = (chaptersRaw?.data ?? []) as ChapterItem[];

    return chapters.map((c) => {
      const num = Number(/(\d+)/.exec(c.chapter_name ?? '')?.[1] ?? NaN);
      const label = c.chapter_title ? `${c.chapter_name ?? ''} — ${c.chapter_title}` : c.chapter_name ?? '';
      const created = c.created_at ? Date.parse(c.created_at) : NaN;
      return {
        name: label || `Chapter ${c.id ?? ''}`,
        url: `${this.baseUrl}/series/${slug}/chapter/${c.chapter_slug ?? c.id}`,
        chapterNumber: Number.isNaN(num) ? undefined : num,
        dateUpload: Number.isNaN(created) ? undefined : created,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    // Omega Scans sert les scans depuis un lecteur heberge ailleurs ; les URLs
    // d'images ne sont pas derivables de l'API JSON sans passer par le lecteur.
    return [];
  }
}