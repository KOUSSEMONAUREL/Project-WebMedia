import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Port de https://kitsunedawn.com — webtoons et manhwa.
 *
 * Aucune source upstream ne reference ce site : l'issue #419 le liste en
 * "NOUVELLE upstream - Site web", donc il n'y a pas de `.kt` a transcrire.
 *
 * Piege d'architecture, mesure et documente : **la racine `/` affiche
 * "No series found" alors que `/latest` en sert 95.** Un port qui vise `/` ne
 * renvoie rien, sans erreur visible. On vise donc `/latest`.
 *
 * Deuxieme piege : sur `/latest`, les 95 liens `/read/<uuid>` sont tous des liens
 * "latest-chapter" et le HTML ne contient **ni nom de serie ni couverture** -- le
 * conteneur est rendu par Alpine.js. Les deux attributs necessaires a un port sont
 * donc recuperes en ouvrant chaque fiche `/read/<uuid>`, dont le `<title>` porte
 * le nom de la serie. C'est lent (95 requetes), mais le catalogue est petit et
 * `getPopular` est mis en cache.
 *
 * Format d'URL de fiche : `https://kitsunedawn.com/read/<uuid>`. C'est bien la
 * fiche d'une serie et non un chapitre isole : le titre se lit
 * « <Nom de la serie> : <sous-titre> - Share Chapter 05 », et le nom de la serie
 * en est le premier segment.
 */

type CheerioQuery = ReturnType<BaseScraper['$']>;
type CheerioInput = Parameters<CheerioQuery>[0];

const LATEST_PATH = '/latest';

export class KitsuneDawnScraper extends BaseScraper {
  readonly name = 'Kitsune Dawn';
  readonly baseUrl = 'https://kitsunedawn.com';
  readonly lang = 'en';

  /** Cache du catalogue : chaque entree coute une requete (voir la note de tete). */
  private cache: Manga[] | null = null;

  /**
   * `/latest` ne rend que des liens `/read/<uuid>` sans titre. On ouvre donc chaque
   * fiche et on en extrait le nom de la serie.
   *
   * Le `<title>` du site est :
   *   "<serie> : <sous-titre> Share Chapter NN - English | Kitsune Dawn"
   * ou, quand la serie n'a pas de sous-titre :
   *   "<serie> Share Chapter NN - English | Kitsune Dawn"
   *
   * Attention : "Share Chapter" est colle au sous-titre, il n'y a pas de tiret
   * devant. Une regex exigeant `[-|]` devant ne retire rien et laissait le titre
   * entier, sous-titre et numero de chapitre compris.
   */
  private seriesTitleFrom(rawTitle: string): string {
    // cheerio rend le texte du <title> avec les entities HTML encore echappees
    // ("You Can&#039;t Escape") ; on les decode avant toute comparaison.
    const pageTitle = rawTitle
      .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
    // L'ordre compte : le suffixe de site et la langue sont en fin de chaine, le
    // numero de chapitre est juste avant. Retirer "Chapter NN" avant d'avoir retire
    // "- English | Kitsune Dawn" ne matchait donc rien, et le titre sortait entier.
    return pageTitle
      .replace(/\s*\|\s*Kitsune Dawn\s*$/i, '')
      .replace(/\s*[-–]\s*English\s*$/i, '')
      // "... Room Share Chapter NN" et "... Room Share [Webtoon][Japanese]"
      .replace(/\s*[-–|]?\s*Share\b.*$/i, '')
      // "... Ride Hood Chapter NN", sans "Share" ni separateur.
      .replace(/\s*[-–|]?\s*Chapter\s+\d+\s*$/i, '')
      .replace(/\s*\[[^\]]*\]\s*$/i, '')
      // Le sous-titre est apres le premier " : " ; le nom de la serie est avant.
      .split(/\s:\s/)[0]
      .trim();
  }

  private async fetchAll(): Promise<Manga[]> {
    if (this.cache) return this.cache;
    const res = await this.get(LATEST_PATH);
    const $ = this.$(res.data as string);
    const urls: string[] = [];
    $('a[href^="/read/"]').each((_i, element) => {
      const href = $(element).attr('href') ?? '';
      if (href && !urls.includes(href)) urls.push(href);
    });

    const mangas: Manga[] = [];
    for (const url of urls) {
      try {
        const page = await this.get(url);
        const title = this.seriesTitleFrom(this.$(page.data as string)('title').first().text());
        if (!title) continue;
        // Deduplication : plusieurs chapitres de la meme serie pointent chacun
        // vers une fiche /read/<uuid> differente, mais un seul nous interesse.
        if (mangas.some(m => m.title === title)) continue;
        mangas.push({ title, url, thumbnailUrl: '', lang: this.lang });
      } catch {
        // Une fiche indisponible ne doit pas faire echouer tout le catalogue.
      }
    }

    this.cache = mangas;
    return mangas;
  }

  async getPopular(): Promise<SearchResult> {
    return { mangas: await this.fetchAll(), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    return this.getPopular();
  }

  async getSearch(query: string): Promise<SearchResult> {
    const all = await this.fetchAll();
    const needle = query.trim().toLowerCase();
    if (!needle) return { mangas: all, hasNextPage: false };
    return {
      mangas: all.filter(m => m.title.toLowerCase().includes(needle)),
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const title = this.seriesTitleFrom($('title').first().text());
    const thumb = $('meta[property="og:image"]').attr('content')
      || $('img[src*="/series/"]').first().attr('src')
      || '';

    return {
      title: title || undefined,
      thumbnailUrl: this.absUrl(thumb),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];

    // La page d'une serie porte la liste de ses chapitres ; sur la fiche `/read/`
    // d'une serie, ce sont les liens internes `/read/` vers les autres chapitres.
    $('a[href^="/read/"]').each((index, element) => {
      const $el = $(element);
      const href = $el.attr('href') ?? '';
      if (!href || href === mangaUrl) return;
      const label = ($el.attr('aria-label') || $el.attr('title') || $el.text())
        .replace(/\s+/g, ' ')
        .trim();
      if (!label) return;
      const num = Number.parseFloat(/(\d+(?:\.\d+)?)/.exec(label)?.[0] ?? '');
      chapters.push({
        name: label,
        url: href,
        chapterNumber: Number.isFinite(num) ? num : undefined,
      });
    });

    return chapters.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data as string);
    const pages: Page[] = [];

    $('img').each((_i, element) => {
      const $img = $(element);
      const src = $img.attr('data-src') || $img.attr('src') || '';
      if (!src || src.includes('/site-assets/')) return;
      pages.push({ imageUrl: this.absUrl(src), index: pages.length });
    });

    return pages;
  }
}

export default KitsuneDawnScraper;