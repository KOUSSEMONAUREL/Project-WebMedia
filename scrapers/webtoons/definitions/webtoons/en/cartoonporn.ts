import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Port de https://cartoonporn.to — comic porno WordPress.
 *
 * Aucune source upstream ne reference ce site : l'issue #419 le liste en
 * "NOUVELLE upstream - Site web", donc il n'y a pas de `.kt` a transcrire. Les
 * selecteurs ci-dessous ont ete releves sur le HTML servi.
 *
 * Le site est un WordPress standard, mais `/wp-json` repond **401** : l'API REST
 * est verrouillee. Le port passe donc par le HTML, comme le veut `CONTRIBUTING.md`.
 * La racine `/` ne sert que sept liens de navigation et parait vide ; tout le
 * catalogue est sur `/porncomic/`, qui rend 90 liens de series et ~71 ko de texte.
 *
 * Format d'URL : `https://cartoonporn.to/porncomic/<slug>/`.
 *
 * Note de portabilite : la pipeline n'ingere que l'URL de la serie
 * (`result.rootUrl`) pour `type === 'webtoon'`. Les pages des chapitres ne sont pas
 * necessaires, et `getPageList` est donc volontairement limite a ce que le lecteur
 * rend sans navigateur.
 */

type CheerioQuery = ReturnType<BaseScraper['$']>;
type CheerioInput = Parameters<CheerioQuery>[0];

const CATALOGUE_PATH = '/porncomic/';

export class CartoonPornScraper extends BaseScraper {
  readonly name = 'CartoonPorn';
  readonly baseUrl = 'https://cartoonporn.to';
  readonly lang = 'en';

  /**
   * Tuile du catalogue :
   * <div class="item-thumb" data-post-id="285925">
   *   <a href="/porncomic/<slug>/" title="..."><img src="..."></a>
   * </div>
   * Le titre est aussi dans l'attribut `title` de l'ancre, ce qui evite de dependre
   * du texte rendu autour de l'image.
   */
  private parseCatalog(html: string): Manga[] {
    const $ = this.$(html);
    const mangas: Manga[] = [];

    $('div.item-thumb[data-post-id]').each((_i, element) => {
      const $el = $(element);
      const link = $el.find('a').first();
      const href = link.attr('href') ?? '';
      if (!href || !href.includes('/porncomic/')) return;

      const title = (link.attr('title') || $el.find('img').first().attr('alt') || '').trim();
      if (!title) return;

      const thumb = $el.find('img').first().attr('src') ?? '';
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
    // Pas de classement "recent" distinct du catalogue : `/porncomic/` est la seule
    // liste de series. On la renvoie telle quelle plutot que d'inventer un tri.
    return this.getPopular();
  }

  /** Pas de recherche serveur (le site n'en expose pas) : on filtre le catalogue. */
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
    const res = await this.get(`${mangaUrl.replace(/\/$/, '')}/`);
    const $ = this.$(res.data as string);
    const title = ($('h1').first().text() || $('title').first().text())
      .replace(/\s*[|\-–]\s*Free Cartoon Porn.*$/i, '')
      .trim();

    // Resume : le site rend la description dans un bloc d'article.
    const summary = $('div.entry-content, div.post-content, .item__description')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // Le menu de navigation contient un lien "Artists" qui n'a rien a voir avec
    // l'auteur de la fiche : on ne prend que les liens situes dans l'article.
    const author = $('div.entry-content a[href*="/artists/"], span[itemprop="author"] a')
      .first()
      .text()
      .trim() || undefined;
    const thumb = $('meta[property="og:image"]').attr('content')
      || $('div.item-thumb img').first().attr('src')
      || '';

    return {
      title: title || undefined,
      description: summary || undefined,
      author,
      thumbnailUrl: this.absUrl(thumb),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(`${mangaUrl.replace(/\/$/, '')}/`);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];

    // La liste des chapitres est injectee en JavaScript : sur la fiche de
    // "All in the Name of Eros" le <ul role="list" data-total_chapters="1"> est
    // vide dans le HTML servi. On tente donc les liens de lecture, et on complete
    // avec les URLs numerotees si le total annonce n'est pas atteint -- le port
    // reste incomplet cote chapitres, ce qui est sans effet ici (voir la note de
    // portabilite en tete de fichier).
    const total = Number.parseInt(
      $('#chapters [data-total_chapters]').first().attr('data-total_chapters') ?? '0',
      10,
    );
    $('a[href*="/read/"], li.chapter a[href], .ch-item a[href]').each((index, element) => {
      const $el = $(element);
      const href = $el.attr('href') ?? '';
      if (!href) return;
      const name = $el.text().replace(/\s+/g, ' ').trim() || `Chapter ${index + 1}`;
      const num = Number.parseFloat(/(\d+(?:\.\d+)?)/.exec(name)?.[0] ?? '');
      chapters.push({
        name,
        url: href.replace(this.absUrl('/'), '/'),
        chapterNumber: Number.isFinite(num) ? num : undefined,
      });
    });

    // Deduplication : la fiche peut lister un chapitre plusieurs fois (vignette + titre).
    const seen = new Set<string>();
    const unique = chapters.filter(c => (seen.has(c.url) ? false : (seen.add(c.url), true)));

    // Completude : si le HTML ne rend aucun chapitre mais que la fiche en annonce,
    // on synthetise les URLs numerotees, qui repondent 200.
    if (unique.length === 0 && Number.isFinite(total) && total > 0) {
      const slug = mangaUrl.replace(/^\/|\/+$/g, '');
      for (let n = 1; n <= Math.min(total, 50); n++) {
        unique.push({ name: `Chapter ${n}`, url: `/${slug}/${n}/`, chapterNumber: n });
      }
    }

    return unique.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
  }

  /**
   * Le lecteur est une page par image cote client, et la pipeline n'ingere pas les
   * images pour `type === 'webtoon'`. On rend donc ce que le HTML donne
   * directement, sans suivre une navigation image par image.
   */
  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data as string);
    const pages: Page[] = [];

    $('img').each((_i, element) => {
      const $img = $(element);
      const src = $img.attr('data-src') || $img.attr('src') || '';
      // On ignore les logos et sprites du theme.
      if (!src || src.includes('/wp-content/themes/') || src.includes('/wp-includes/')) return;
      if (!/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(src)) return;
      pages.push({ imageUrl: this.absUrl(src), index: pages.length });
    });

    return pages;
  }
}

export default CartoonPornScraper;