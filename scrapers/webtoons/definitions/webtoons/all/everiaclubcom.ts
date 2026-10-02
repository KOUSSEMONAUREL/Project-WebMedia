import { BaseScraper } from '../../../engine/base';
import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `all/everiaclubcom` (EveriaClubCom.kt).
 *
 * Site HTML (pas de WP-REST) : galeries compatibles Comicfront. Chaque série
 * est une collection de pages ("Gallery").
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - Les filtres (Tag/Category `UriPartFilter`) ne sont pas portés : le
 *   moteur TS n'expose que `search`. Seule la branche `query` de search est
 *   conservée ; l'URL utilisée est exactement celle du Kt
 *   (`/search//?keyword=<q>&page=<N>`). Un `query` vide retombe sur la page
 *   courante de "latest" comme dans le Kt.
 *
 * Limite externe connue : toutes les images sont servies par `files.pursue.cc`,
 * qui est derriere Cloudflare et renvoie un interstitiel « Just a moment... » en
 * 403 aux requetes automatisées (verifie sur 16/16 URLs d'une galerie, toutes
 * presentes telles quelles dans le HTML). Les URL extraites sont donc correctes,
 * mais leur telechargement Cote backend depend du CDN : ce n'est pas un defaut
 * de ce port et aucun selecteur ne peut le contourner.
 */

function unescapeEntities(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export class EveriaClubComScraper extends BaseScraper {
  readonly name = 'EveriaClub.com';
  readonly baseUrl = 'https://www.everiaclub.com';
  readonly lang = 'all';

  private imgSrc($img: Cheerio<Element>): string {
    return (
      $img.attr('data-original') ||
      $img.attr('data-lazy-src') ||
      $img.attr('data-src') ||
      $img.attr('src') ||
      ''
    );
  }

  private mangaFromElement($: ReturnType<typeof this.$>, el: Element): Manga {
    const $el = $(el);
    const rawHref = this.absUrl($el.attr('href') ?? '');
    const $img = $el.find('img').first();
    const title = unescapeEntities($img.attr('title') || '');
    return {
      title,
      url: rawHref.replace(this.baseUrl, ''),
      thumbnailUrl: this.absUrl(this.imgSrc($img)) || '',
      lang: this.lang,
    };
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.mainleft .leftp > a').each((_i, el) => {
      mangas.push(this.mangaFromElement($, el));
    });
    const hasNextPage = $('li:has(span.current) + li > a').length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?page=${page}`);
    return this.parseMangaList(res.data);
  }

  async getPopular(_page: number = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.mainright li a').each((_i, el) => {
      mangas.push(this.mangaFromElement($, el));
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    let res;
    if (query.trim().length > 0) {
      const url = new URL(`${this.baseUrl}/search//`);
      url.searchParams.set('keyword', query.trim());
      url.searchParams.set('page', String(page));
      res = await this.get(url.toString());
    } else {
      res = await this.get(`${this.baseUrl}/?page=${page}`);
    }
    return this.parseMangaList(res.data);
  }

  private ownText($el: Cheerio<Element>): string {
    const clone = $el.clone();
    clone.children().remove();
    return clone.text().trim();
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    const genre = $('div.end span:contains(Tags:) ~ a > p.tags')
      .map((_i, el) => this.ownText($(el)))
      .get()
      .join(', ');
    // Le Kt laisse details.title vide. `h1` porte exactement la chaine du
    // catalogue (verifie sur 5 fiches), donc on complete plutot que de renvoyer
    // une fiche sans titre, que le backend ne peut pas afficher.
    return {
      title: $('h1').first().text().trim() || undefined,
      genre: genre || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [
      {
        name: 'Gallery',
        url: mangaUrl,
        chapterNumber: 1,
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.mainleft img').each((index, el) => {
      const src = this.imgSrc($(el));
      if (src) pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }
}