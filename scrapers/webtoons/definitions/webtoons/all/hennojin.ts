import { BaseScraper } from '../../../engine/base';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `all/hennojin` (Hennojin.kt).
 *
 * WordPress. « Popular » sert de « Latest » (la source affiche `supportsLatest
 * = false` : getLatest lève UnsupportedOperationException). La recherche est
 * ignorée par WordPress sans le nonce courant (`input#_wpnonce`) qui tourne à
 * chaque pagination.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - Le Kt définit deux sources (en/ja) ; ce port fusionne sous `lang='all'`,
 *   donc le chemin de popular suit la branche `else` (sans `archive=raw` ni
 *   `page/N/` à la mode ja).
 * - `getLatest` lève UnsupportedOperationException (« not implemented » du
 *   moteur), comme le Kt.
 * - La date de chapitre (HEAD Last-Modified de la vignette) est effectuée
 *   avec `this.client.head` ; non parsable → pas de date (identique au Kt qui
 *   retombe sur tryParseZonedDateTime → 0).
 * - La fiche renvoie un titre, ce que le Kt ne fait pas (`details.title` y est
 *   laissé vide). Le catalogue sert le titre anglais ; `h1.manga-title` ne porte
 *   que l'original japonais, et `<title>` le titre anglais suivi de « – Hennojin ».
 *   On lit donc `<title>` en retirant ce suffixe, ce qui redonne exactement la
 *   chaîne du catalogue (vérifié sur 6 fiches).
 */

const RFC_1123_REGEX =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

// WordPress suffixe chaque <title> par « – Hennojin ».
const TITLE_SUFFIX_REGEX = /\s*[–—\-]\s*Hennojin\s*$/;

function parseDateUpload(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = RFC_1123_REGEX.exec(value.trim());
  if (!match) return undefined;
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const month = months[match[3]];
  if (month === undefined) return undefined;
  const date = Date.UTC(
    Number(match[4]),
    month,
    Number(match[2]),
    Number(match[5]),
    Number(match[6]),
    Number(match[7]),
  );
  return Number.isNaN(date) ? undefined : date;
}

export class HennojinScraper extends BaseScraper {
  readonly name = 'Hennojin';
  readonly baseUrl = 'https://hennojin.com';
  readonly lang = 'all';

  private httpUrl(): URL {
    return new URL(`${this.baseUrl}/home`);
  }

  private stripDomain(rawUrl: string): string {
    const u = new URL(rawUrl, this.baseUrl);
    return u.pathname + u.search;
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    // Le Kt garde une branche `lang == "ja"` (`/page/N/` + `archive=raw`) ; le
    // port fusionne les sources sous `lang='all'`, donc seule la branche
    // `else` est atteignable (cf. divergence documentée en tête de fichier).
    const url = this.httpUrl();
    url.pathname = `${url.pathname}/page/${page}`;
    const res = await this.get(url.toString());
    return this.parseMangaList(res.data);
  }

  async getLatest(_page: number = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not supported (popular doubles as latest)`);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const nonceRes = await this.get(this.httpUrl().toString());
    const nonce = this.$(nonceRes.data)('input#_wpnonce').first().attr('value') ?? '';
    if (!nonce) {
      throw new Error(`${this.name}: could not find WordPress nonce`);
    }

    const url = this.httpUrl();
    url.pathname = `${url.pathname}/page/${page}`;
    url.searchParams.set('keyword', query);
    url.searchParams.set('_wpnonce', nonce);
    const res = await this.get(url.toString());
    return this.parseMangaList(res.data);
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.grid-items .layer-content').each((_i, el) => {
      const $el = $(el);
      const $titleLink = $el.find('.title_link > a').first();
      const thumbnail = $el.find('img').first().attr('src');
      if ($titleLink.length === 0) return;
      mangas.push({
        title: $titleLink.text(),
        url: this.stripDomain(this.absUrl($titleLink.attr('href') ?? '')),
        thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : '',
        lang: this.lang,
      });
    });
    const hasNextPage = $('.paginate .next').length > 0;
    return { mangas, hasNextPage };
  }

  /**
   * Titre de la fiche, au format anglais du catalogue.
   *
   * `h1.manga-title` ne convient pas: il ne porte que le titre original
   * japonais, alors que le catalogue sert la traduction. `<title>` porte bien
   * l'anglais, avec le suffixe « – Hennojin » que WordPress ajoute.
   */
  private titleOf($: CheerioAPI): string {
    return $('title').first().text().trim().replace(TITLE_SUFFIX_REGEX, '').trim();
  }

  private descriptionTextOf($el: Cheerio<Element>): string {
    $el.find('br').prepend('\\n');
    return $el
      .text()
      .split('\\n')
      .join('\n')
      .split('\n ')
      .join('\n');
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);

    const description = $('.manga-subtitle + p + p')
      .map((_i, el) => this.descriptionTextOf($(el)))
      .get()
      .filter((t) => t.length > 0)
      .join('\n');

    const genre = $(
      '.tags-list a[href*=/parody/],.tags-list a[href*=/tags/],.tags-list a[href*=/character/]',
    )
      .map((_i, el) => $(el).text())
      .get()
      .join(', ');

    const artist = $('.tags-list a[href*=/artist/]').first().text();
    const author = $('.tags-list a[href*=/group/]').first().text() || artist;

    return {
      title: this.titleOf($) || undefined,
      author: author || undefined,
      artist: artist || undefined,
      genre: genre || undefined,
      description: description || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);

    const thumbUrl = $('.manga-thumbnail > img').first().attr('src');
    let dateUpload: number | undefined;
    if (thumbUrl) {
      try {
        const headRes = await this.client.head(this.absUrl(thumbUrl));
        dateUpload = parseDateUpload(headRes.headers['last-modified'] as string | undefined);
      } catch {
        // ensureSuccess = false côté Kt : un HEAD qui échoue n'ajoute pas de date.
      }
    }

    const chapters: Chapter[] = [];
    $('a:contains(Read Online)').each((_i, el) => {
      const $el = $(el);
      const rawUrl = this.absUrl($el.attr('href') ?? '');
      let chapterUrl = rawUrl;
      try {
        const parsed = new URL(rawUrl);
        parsed.searchParams.delete('view');
        parsed.searchParams.set('view', 'multi');
        chapterUrl = parsed.toString();
      } catch {
        // keep raw
      }
      const chapter: Chapter = {
        name: 'Chapter',
        url: this.stripDomain(chapterUrl),
        chapterNumber: -1,
      };
      if (dateUpload !== undefined) chapter.dateUpload = dateUpload;
      chapters.push(chapter);
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.slideshow-container > img').each((index, el) => {
      pages.push({ index, imageUrl: this.absUrl($(el).attr('src') ?? '') });
    });
    return pages;
  }
}