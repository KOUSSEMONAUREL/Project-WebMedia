import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi src/fr/manganova (MangaNova.kt, KeiSource,
 * libVersion 1.6).
 *
 * Le site n'a pas de front HTML exploitable : MangaNova.kt interroge une API
 * JSON sous un Bearer et ne fait aucun parsing Jsoup. On reproduit cette
 * architecture plutot que d'inventer une version HTML, parce que l'API est
 * seule a exposer les chapitres et les pages.
 *
 * Particularites conservees du port Kotlin :
 * - le Bearer est un jeton statique encode en base64, et non une cle de session.
 *   Upstream le met en constante DEFAULT_TOKEN et le stocke dans un cookie
 *   "token" ; on garde le jeton en dur car il est public dans le binaire.
 * - `getPopular` et `getLatest` lisent deux champs distincts du meme catalogue
 *   (`series` et `new_series`). Upstream les melange dans MangasPage a plat, ce
 *   qui ecrase la distinction ; on les garde separes sinon "derniers ajouts" et
 *   "populaires" renverraient la meme liste.
 * - un chapitre est ecarte quand `amount != 0` : ce champ compte les pages
 *   bloquees, donc un chapitre payant n'a pas d'images a scraper.
 * - les chapitres sont tries par numero decroissant, comme upstream.
 */

// Jeton public de l'extension, repris tel quel de MangaNova.kt DEFAULT_TOKEN.
const API_BEARER =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJtZW1icmVfaWQiOjAsIm1lbWJyZV91c2VybmFtZSI6bnVsbCwiaWF0IjoxNzA1NTc5MDQ1fQ.51qivLd2l3OKbDaYYzlntZJNnreRSBWO7p5Nsa2mAsA';

interface ApiSerie {
  title: string;
  title_jap: string;
  slug: string;
  description: string;
  genres: string;
  poster: string;
  author: string;
  dessinateur: string;
  running: string | number;
}

interface ApiChapter {
  title: string;
  sub_title: string;
  number: number;
  available_time: number;
  amount: number;
}

interface ApiCategory {
  title: string;
  chapitres: ApiChapter[];
}

export class MangaNovaScraper extends BaseScraper {
  readonly name = 'MangaNova';
  readonly baseUrl = 'https://www.manga-nova.com';
  readonly lang = 'fr';

  private readonly apiUrl = 'https://api.manga-nova.com';

  /**
   * Appel JSON vers l'API. Passe par `client` et non par `get()` : `get()`
   *Rajoute un Referer et resolve les chemins contre baseUrl (le site public),
   * alors que l'API est sur un autre host et exige un Bearer. Surcharger `get()`
   * aurait casse son type de retour, donc on l'appelle explicitement.
   */
  private async apiGet<T>(path: string): Promise<T> {
    const res = await this.client.get(`${this.apiUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${API_BEARER}`,
        Accept: 'application/json',
        Referer: this.baseUrl + '/',
      },
    });
    return res.data as T;
  }

  private toManga(serie: ApiSerie): Manga {
    return {
      title: serie.title,
      // Upstream expose /manga/<slug> ; on garde cette forme pour que le
      // slug reste derivable par la meme regle que les autres ports.
      url: `/manga/${serie.slug}`,
      thumbnailUrl: serie.poster || '',
      lang: this.lang,
      author: serie.author || undefined,
      artist: serie.dessinateur || undefined,
      description: serie.description || undefined,
      genre: serie.genres ? serie.genres.split(',').join(', ') : undefined,
      // running == 0 upstream : completed, sinon ongoing.
      status: Number(serie.running) === 0 ? 1 : 2,
    };
  }

  private async fetchCatalogue(): Promise<{ series: ApiSerie[]; new_series: ApiSerie[] }> {
    const data = await this.apiGet<{ series: ApiSerie[]; new_series: ApiSerie[] }>('/catalogue/');
    return { series: data.series ?? [], new_series: data.new_series ?? [] };
  }

  async getPopular(): Promise<SearchResult> {
    const catalogue = await this.fetchCatalogue();
    return { mangas: catalogue.series.map(s => this.toManga(s)), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    const catalogue = await this.fetchCatalogue();
    return { mangas: catalogue.new_series.map(s => this.toManga(s)), hasNextPage: false };
  }

  /**
   * L'API ne propose pas de recherche : upstream passe le fragment `#query`
   * dans l'URL, que le serveur ignore, puis filtre le catalogue cote client.
   * On fait pareil, en ignorant les query qui ne sont pas des sous-chaînes.
   */
  async getSearch(query: string): Promise<SearchResult> {
    const catalogue = await this.fetchCatalogue();
    const needle = query.trim().toLowerCase();
    const all = [...catalogue.series, ...catalogue.new_series];

    if (!needle) {
      return { mangas: all.map(s => this.toManga(s)), hasNextPage: false };
    }

    const seen = new Set<string>();
    const mangas: Manga[] = [];
    for (const serie of all) {
      if (seen.has(serie.slug)) continue;
      const hit =
        serie.title?.toLowerCase().includes(needle) ||
        serie.title_jap?.toLowerCase().includes(needle);
      if (!hit) continue;
      seen.add(serie.slug);
      mangas.push(this.toManga(serie));
    }
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFrom(mangaUrl);
    const data = await this.apiGet<{ serie: ApiSerie & { chapitres: ApiCategory[] } }>(`/mangas/${slug}`);
    const serie = data.serie;
    if (!serie) return {};
    const base = this.toManga(serie);
    return {
      title: base.title,
      description: base.description,
      author: base.author,
      artist: base.artist,
      genre: base.genre,
      thumbnailUrl: base.thumbnailUrl,
      status: base.status,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFrom(mangaUrl);
    const data = await this.apiGet<{ serie: { slug: string; chapitres: ApiCategory[] } }>(`/mangas/${slug}`);
    const categories = data.serie?.chapitres ?? [];

    const now = Date.now();
    const chapters: Chapter[] = [];

    for (const category of categories) {
      for (const raw of category.chapitres ?? []) {
        // amount != 0 : chapitre bloque, aucune page a recuperer. Upstream
        // fait le meme tri.
        if (raw.amount !== 0) continue;

        const number = Number(raw.number);
        chapters.push({
          name: `${category.title} - ${raw.title} - ${raw.sub_title}`.trim(),
          url: `${this.baseUrl}/lecture-en-ligne/${slug}/chapitre/${number}`,
          chapterNumber: Number.isFinite(number) ? number : undefined,
          // available_time est un decalage relatif en secondes, pas un
          // timestamp : c'est la seule lecture qui donne une date plausible.
          dateUpload: Number.isFinite(raw.available_time) ? now + raw.available_time * 1000 : undefined,
        });
      }
    }

    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = this.slugFrom(chapterUrl);
    const chapterNumber = this.numberFrom(chapterUrl);
    const data = await this.apiGet<{ images: { image: string; page_number: number }[] }>(
      `/mangas/${slug}/chapitres/${chapterNumber}`
    );
    const images = data.images ?? [];
    return images.map((img, index) => ({
      imageUrl: img.image,
      // page_number est 0-based chez l'API, index l'est aussi dans notre Page.
      index: typeof img.page_number === 'number' ? img.page_number : index,
    }));
  }

  /** slug : 2e segment de /manga/<slug> comme /lecture-en-ligne/<slug>/chapitre/<n> */
  private slugFrom(url: string): string {
    const parts = url.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'manga' || p === 'lecture-en-ligne');
    return idx >= 0 ? parts[idx + 1] ?? parts[parts.length - 1] : parts[parts.length - 1];
  }

  /** dernier segment = numero de chapitre */
  private numberFrom(url: string): string | number {
    const parts = url.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    const n = Number(last);
    return Number.isFinite(n) ? n : (last ?? '');
  }
}

export default MangaNovaScraper;
