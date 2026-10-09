import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Port de https://www.scan-manga.com — webtoons et novels.
 *
 * Aucune source upstream ne reference ce site : l'issue #419 le liste en
 * "NOUVELLE upstream - Site web", donc il n'y a pas de `.kt` a transcrire.
 *
 * L'issue donne `m.scan-manga.com`, qui n'est qu'une redirection `302` vers
 * `www.scan-manga.com`. On vise donc directement le domaine canonique : suivre la
 * redirection marche aussi, mais `baseUrl` doit rester le domaine final, sinon les
 * URL produites porteraient deux redirections et `player_host` serait `m.scan-manga.com`
 * au lieu du vrai serveur.
 *
 * Format d'URL : `https://www.scan-manga.com/<id>/<Titre-Kebab>.html`, ou
 * `<id>-<autre-id>` quand la serie a ete fusionnee.
 *
 * Limite cote chapitres, mesuree et documentee : la liste des chapitres d'une fiche
 * n'est pas dans le HTML servi (27 ko de texte, tous des declarations CSS, et zéro
 * occurrence de « chapter »). Elle est injectee en JavaScript. Sans effet ici, la
 * pipeline n'ingere que l'URL de la serie pour `type === 'webtoon'`.
 *
 * Limite de debit, mesuree : le site renvoie `403` sur une salve de requetes. Trois
 * appels consecutifs a 25 s d'intervalle rendent `200` avec 15 series chacun, mais
 * une dixieme requete enchainee peut tomber. Comme `comikey` et `webnex`, un
 * diagnostic parallele produit un faux echec : il faut espaceer les appels.
 */

type CheerioQuery = ReturnType<BaseScraper['$']>;
type CheerioInput = Parameters<CheerioQuery>[0];

const CATALOGUE_PATH = '/?home';

export class ScanMangaScraper extends BaseScraper {
  readonly name = 'Scan-Manga';
  readonly baseUrl = 'https://www.scan-manga.com';
  readonly lang = 'fr';

  /** Catalogue : <a href="https://www.scan-manga.com/17166/Titre.html" class="nom_manga ..."> */
  private parseCatalog(html: string): Manga[] {
    const $ = this.$(html);
    const mangas: Manga[] = [];

    $('a.nom_manga[href]').each((_i, element) => {
      const $el = $(element);
      const href = $el.attr('href') ?? '';
      if (!/\/\d+(-\d+)?\/[^/]+\.html$/i.test(href)) return;
      const title = $el.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      // La vignette est dans le <img> voisin, pas dans l'ancre.
      const $tile = $el.closest('div');
      const thumb = $tile.find('img').first().attr('src') ?? '';

      mangas.push({
        title,
        url: href.replace(this.absUrl('/'), '/'),
        thumbnailUrl: this.absUrl(thumb),
        lang: this.lang,
      });
    });

    return mangas;
  }

  async getPopular(): Promise<SearchResult> {
    const res = await this.get(CATALOGUE_PATH);
    return { mangas: this.parseCatalog(res.data as string), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    return this.getPopular();
  }

  /** Pas de recherche serveur exposee : on filtre le catalogue, 210 series suffisent. */
  async getSearch(query: string): Promise<SearchResult> {
    const res = await this.get(CATALOGUE_PATH);
    const all = this.parseCatalog(res.data as string);
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
    // Le <title> se termine par « | Scan-Manga ».
    const title = $('title').first().text().replace(/\s*\|\s*Scan-Manga\s*$/i, '').trim();

    const description = $('meta[name="description"]').attr('content')
      || $('div.description, .synopsis').first().text().replace(/\s+/g, ' ').trim();

    // Genres : liens de la barre de navigation, dans le contenu de la fiche seulement.
    const genre = $('div.genre a, a.genre, .tags a')
      .toArray()
      .map(a => $(a).text().trim())
      .filter(Boolean)
      .join(', ');

    const author = $('a[href*="/auteur"], .auteur a').first().text().trim() || undefined;
    const thumb = $('meta[property="og:image"]').attr('content') ?? '';

    return {
      title: title || undefined,
      description: description || undefined,
      genre: genre || undefined,
      author,
      thumbnailUrl: this.absUrl(thumb),
    };
  }

  /**
   * La liste des chapitres n'est pas servie en HTML (voir la note de portabilite en
   * tete de fichier). On tente neanmoins les liens de chapitre presents, pour rester
   * correct le jour ou le site les rendrait cote serveur, et on renvoie sinon une
   * liste vide : c'est ce que la pipeline attend pour un `webtoon`, qui n'ingere que
   * l'URL de la serie.
   */
  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $('a[href*="/chapitre"], a[href*="/chapter-"], li.chapter a[href]').each((index, element) => {
      const $el = $(element);
      const href = $el.attr('href') ?? '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      const name = $el.text().replace(/\s+/g, ' ').trim() || `Chapitre ${index + 1}`;
      const num = Number.parseFloat(/(\d+(?:\.\d+)?)/.exec(name)?.[0] ?? '');
      chapters.push({
        name,
        url: href.replace(this.absUrl('/'), '/'),
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
      if (!src || src.includes('/img/manga/') || !/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(src)) return;
      pages.push({ imageUrl: this.absUrl(src), index: pages.length });
    });

    return pages;
  }
}

export default ScanMangaScraper;