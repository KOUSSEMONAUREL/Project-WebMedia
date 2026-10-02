import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `all/baobua` (BaoBua.kt).
 *
 * Site de galeries WordPress : une série = une galerie = **un seul chapitre**
 * nommé `Gallery`. Il n'y a pas de chapitrage, donc `getChapterList` renvoie
 * toujours une liste de longueur 1.
 *
 * Détails du site qui dictent les sélecteurs :
 * - Les vignettes de liste sont des blocs `.thcovering-video` (vidéos courtes),
 *   dont le titre est le lien `a.denomination` — pas un `<h2>`.
 * - Le lecteur est un bloc `div.contentme` où chaque image est enveloppée dans
 *   un lien `/img.html` vers la version plein format ; `img` seul donnerait la
 *   vignette.
 * - Une galerie longue est paginée via `a.page-numbers`, dont le lien `Next`
 *   est le seul à suivre. Une galerie sur une page n'a **aucun** `a.page-numbers`
 *   : le port s'arrête donc sur l'absence de `Next`, jamais sur un compteur.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - `getLatest` lève une erreur comme le Kt (`supportsLatest = false`).
 * - Les filtres `SourceCategorySelector` du Kt ne sont pas portés : une
 *   recherche à query vide retombe sur `getPopular`, qui est le `else` du Kt.
 * - `getMangasByUrl` du Kt (ajout par URL : détecte une fiche et renvoie une
 *   série unique) n'a pas d'équivalent ici, le moteur séparant les listes
 *   (`getSearch`/`getPopular`) des détails (`getMangaDetails`). La partie utile
 *   de cette branche — le titre `h2.box-mt-output` nettoyé, et la vignette
 *   tirée du `IMAGE_SELECTOR` — est conservée dans `getMangaDetails`.
 * - Le `rateLimit(3)` du Kt n'a pas d'équivalent dans le moteur TS.
 * - `Instant.tryParse` tolère l'offset `+00:00` que `Date.parse` refuse sur
 *   certaines chaînes : la regex ISO est doncnormalisée avant le `Date.parse`,
 *   et une date non parsable est omise plutôt que mise à 0 (le Kt tombe sur 0).
 */

/** Sélecteur du Kt : l'image doit être wrappée dans un lien `/img.html`. */
const IMAGE_SELECTOR = 'div.contentme a[href^=/img.html] img';

/** ` | Page 3/12` en fin de titre de la fiche. */
const PAGE_SUFFIX_REGEX = / \| Page \d+\/\d+$/;

const WP_COM_PREFIX_REGEX = /^https:\/\/i\d+\.wp\.com\//;

function parsePublishedDate(html: string): number | undefined {
  const match = /"datePublished":"([^"]+)"/.exec(html);
  if (!match) return undefined;
  const raw = match[1].trim();
  // `+00:00` final n'est pas accepté par tous les runtimes ; on le passe en `Z`.
  const normalized = raw.replace(/([+-]\d{2}):(\d{2})$/, '$1$2').replace(
    /([+-]\d{2})(\d{2})$/,
    '$1:$2',
  );
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}

export class BaobuaScraper extends BaseScraper {
  readonly name = 'BaoBua';
  readonly baseUrl = 'https://baobua.net';
  readonly lang = 'all';

  /**
   * Le CDN WordPress sert `https://iN.wp.com/<chemin>?w=640` : la vignette
   * 640 px de large. On retire le préfixe pour récupérer l'original et on
   * supprime le paramètre de largeur.
   */
  private normalizeImageUrl(url: string): string {
    if (!WP_COM_PREFIX_REGEX.test(url)) return url;
    return url.replace(/https:\/\/i\d+\.wp\.com\//, 'https://').replace('?w=640', '');
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.thcovering-video').each((_i, el) => {
      const $el = $(el);
      const link = $el.find('a.denomination').first();
      const href = link.attr('href');
      if (!href) return;
      const thumbnail = $el.find('img.xld').first().attr('src');
      mangas.push({
        title: link.text(),
        url: this.absUrl(href).replace(this.baseUrl, ''),
        thumbnailUrl: thumbnail ? this.normalizeImageUrl(this.absUrl(thumbnail)) : '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('a.page-numbers.next').length > 0 };
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?page=${page}`);
    return this.parseMangaList(res.data);
  }

  async getLatest(_page: number = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not supported (supportsLatest = false)`);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    if (query.trim().length === 0) {
      // Sans query, le Kt passe par les filtres de catégorie, non portés ici :
      // c'est le `?: getPopularManga(page)` du Kt.
      return this.getPopular(page);
    }
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    return this.parseMangaList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const $ = this.$(res.data);

    // Le Kt prend `selectFirst("h2.box-mt-output")`, mais cette classe est
    // portée par 4 blocs sur la fiche et le **premier** est un slot
    // publicitaire ("Advertising") : le Kt en tire donc un titre faux. Le même
    // texte est exposé de façon unique par `og:title` (et `<title>`), qu'on
    // préfère. Les blocs `h2` ne servent plus que de repli, en excluant les
    // libellés d'interface.
    const rawTitle = (
      $('meta[property="og:title"]').first().attr('content') ??
      $('title').first().text() ??
      $('h2.box-mt-output')
        .map((_i, el) => $(el).text())
        .get()
        .find((t) => t.trim().length > 0 && !/^(Advertising|NOW|Articles Suggestions)$/i.test(t.trim())) ??
      ''
    ).trim();
    const title = rawTitle
      .replace(/^BaoBua\.Net:\s*/, '')
      .replace(PAGE_SUFFIX_REGEX, '')
      .trim();

    const genre = $('.it-categories a')
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join(', ');

    // La vignette du Kt vient du lecteur (première image de `contentme`).
    const firstImage = $(IMAGE_SELECTOR).first().attr('src');

    return {
      title: title.length > 0 ? title : undefined,
      genre: genre.length > 0 ? genre : undefined,
      thumbnailUrl: firstImage
        ? this.normalizeImageUrl(this.absUrl(firstImage))
        : undefined,
      // `SManga.COMPLETED` : une galerie n'est jamais « en cours ».
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const $ = this.$(res.data);

    // Le Kt préfère le `link[rel=canonical]` et ne garde que le chemin ; à
    // défaut il retombe sur l'URL de la requête.
    const canonical = $('link[rel=canonical]').first().attr('href');
    const chapterUrl = canonical ? this.absUrl(canonical) : abs;

    const chapter: Chapter = {
      name: 'Gallery',
      url: chapterUrl.replace(this.baseUrl, ''),
      chapterNumber: 0,
    };
    const dateUpload = parsePublishedDate(res.data);
    if (dateUpload !== undefined) chapter.dateUpload = dateUpload;
    return [chapter];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const pages: Page[] = [];
    let url: string | undefined = this.absUrl(chapterUrl);
    const visited = new Set<string>([url]);

    // Le Kt boucle tant qu'un lien `Next` existe, en décalant les index par le
    // nombre d'images déjà collectées. Une galerie d'une seule page n'a aucun
    // `a.page-numbers` : la boucle s'arrête au premier tour.
    while (url !== undefined) {
      const res = await this.get(url);
      const $ = this.$(res.data);
      $(IMAGE_SELECTOR).each((_i, el) => {
        const src = $(el).attr('src');
        if (!src) return;
        pages.push({
          index: pages.length,
          imageUrl: this.normalizeImageUrl(this.absUrl(src)),
        });
      });

      // `:contains(Next)` du Kt est un `contains`, pas une égalité : le site
      // rend `Next »`. Le test reste borne aux liens de pagination.
      const next = $('a.page-numbers')
        .filter((_i, el) => $(el).text().includes('Next'))
        .first()
        .attr('href');
      const nextUrl = next ? this.absUrl(next) : undefined;
      // Garde-fou : une galerie sans pagination rend 0 lien et sort au 1er tour.
      // Si le site se met un jour à boucler sur la meme URL, on s'arrete plutot
      // que de boucler indefiniment et de saturer la memoire.
      url = nextUrl !== undefined && !visited.has(nextUrl) ? nextUrl : undefined;
      if (nextUrl !== undefined) visited.add(nextUrl);
    }

    return pages;
  }
}