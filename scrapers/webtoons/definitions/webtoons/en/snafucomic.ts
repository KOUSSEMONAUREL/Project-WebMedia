import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const SERIES_PATH = /^\/[^/]+$/;
const CHAPTER_NUMBER = /\d+(\.\d+)?/;
// "January 18, 2004" dans le libelle d'une option du select.
const SNAFU_DATE = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/;
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export class SnafuComicScraper extends BaseScraper {
  readonly name = 'Snafu Comics';
  readonly baseUrl = 'https://www.snafu-comics.com';
  readonly lang = 'en';

  private toPath(href: string): string | null {
    const trimmed = href.trim();
    if (trimmed.startsWith('/')) return trimmed;
    if (trimmed.startsWith(this.baseUrl)) {
      const path = trimmed.slice(this.baseUrl.length);
      return path || '/';
    }
    return null;
  }

  private async catalogEntries(): Promise<Map<string, Manga>> {
    const res = await this.get('/all-comics');
    const $ = this.$(res.data);
    const entries = new Map<string, Manga>();
    $('a[href]').each((_, el) => {
      const $el = $(el);
      const path = this.toPath($el.attr('href') ?? '');
      if (!path || !SERIES_PATH.test(path)) return;
      const img = $el.find('img').first();
      if (img.length === 0) return;
      // NOTE: cheerio `.text()` concatenates block elements without spaces
      // (Jsoup inserts them), so "Title"+"by Author" may read "Titleby Author".
      // Prefer the explicit tile divs; keep the upstream ` by ` check as fallback.
      const tileTitle = $el.find('.home-tile-title').first().text().replace(/\s+/g, ' ').trim();
      const tileAuthor = $el.find('.home-tile-author').first().text().replace(/\s+/g, ' ').trim();
      const slug = path.slice(1);
      const title = (img.attr('alt') ?? '').trim() || tileTitle;
      if (!title) return;
      let author: string | undefined;
      if (tileAuthor) {
        author = tileAuthor.replace(/^by\s+/i, '').trim() || undefined;
      } else {
        const text = $el.text().replace(/\s+/g, ' ').trim();
        if (!text.includes(' by ')) return;
        author = text.split(' by ').slice(1).join(' by ').trim() || undefined;
      }
      const thumb = img.attr('abs:src') || img.attr('src') || '';
      if (!entries.has(slug)) {
        entries.set(slug, {
          title,
          url: `/${slug}`,
          thumbnailUrl: this.absUrl(thumb),
          author,
          lang: this.lang,
        });
      }
    });
    return entries;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const entries = await this.catalogEntries();
    return { mangas: [...entries.values()], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const entries = await this.catalogEntries();
    const normalized = query.trim().toLowerCase();
    if (!normalized) return { mangas: [...entries.values()], hasNextPage: false };
    const mangas = [...entries.values()].filter(
      (m) => m.title.toLowerCase().includes(normalized) || (m.author ?? '').toLowerCase().includes(normalized),
    );
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.replace(/^\/+/, '').split('/')[0];
    const entries = await this.catalogEntries();
    const entry = entries.get(slug);
    if (!entry) throw new Error(`Series not found in catalog: ${mangaUrl}`);
    return entry;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace(/^\/+/, '').split('/')[0];
    const res = await this.get(`/${slug}/archive`);
    const $ = this.$(res.data);

    // L'archive ne contient PAS de liste de chapitres en liens. Elle affiche un
    // <h1>Archive</h1> suivi de cette seule phrase : "Select a page from the
    // drop-down menu to start reading the comic." Tout le contenu est dans un
    // <select name="comic">, et ce select est un navigateur GLOBAL : il liste les
    // chapitres du site entier, pas ceux de la serie.
    //
    // La version initiale de ce port cherchait des liens apres le <h1>, puis
    // tombait sur tous les <a> de la page. Les deux collectaient les liens de la
    // navigation du lecteur (`cc-first`, `cc-last`, `cc-cast`), donc une serie
    // remontait 15 chapitres qui n'etaient pas les siens -- Powerpuff Girls D en
    // renvoyait "First Day" et "PPG Chapter 1", qui sont a elle, mais une autre
    // serie aurait recu des chapitres d'une serie voisine.
    //
    // On lit donc uniquement le select, filtré sur le slug : c'est la seule
    // source complete et la seule non ambiguë.
    const found: Array<{ href: string; text: string }> = [];
    $('select[name="comic"] option').each((_, el) => {
      const value = ($(el).attr('value') ?? '').trim();
      if (!value) return;
      found.push({ href: `/${value}`, text: $(el).text() });
    });
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const { href, text } of found) {
      const path = this.toPath(href);
      if (!path || seen.has(path)) continue;
      // Filtre par slug, mesure : le select de chaque archive ne contient que
      // les chapitres de SA serie. Verifie sur quatre series --
      // powerpuffgirls 501/501, sugarbits 234/234, naruto 42/42,
      // grimtales 454/454. Il est donc redondant sur ces pages, mais reste
      // garde si l'archive d'une serie devient un select global.
      if (!path.startsWith(`/${slug}/`)) continue;
      seen.add(path);

      // Un libelle d'option est "January 18, 2004 - PPG Chapter 1" : la date
      // precede le titre. On la retire pour nommer le chapitre et on la convertit
      // en dateUpload, ce que le seul `attr('value')` perdait en nommant chaque
      // chapitre `ppg-chapter-1`.
      const label = text.replace(/\s+/g, ' ').trim();
      const [datePart, ...rest] = label.split(' - ');
      const title = rest.join(' - ').trim();
      const chapter: Chapter = { name: title || label || path, url: path };

      const parsed = SNAFU_DATE.exec(datePart.trim());
      if (parsed) {
        const month = MONTHS[parsed[1].toLowerCase()];
        if (month !== undefined) {
          chapter.dateUpload = Date.UTC(Number(parsed[3]), month, Number(parsed[2]));
        }
      }
      const num = CHAPTER_NUMBER.exec(chapter.name)?.[0];
      if (num !== undefined) chapter.chapterNumber = Number.parseFloat(num);
      chapters.push(chapter);
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    try {
      const res = await this.get(chapterUrl);
      const $ = this.$(res.data);
      return $('img[src*="/comics/"]')
        .map((i, el) => ({ index: i, imageUrl: this.absUrl($(el).attr('abs:src') || $(el).attr('src') || '') }))
        .get()
        .filter((p) => p.imageUrl.length > 0);
    } catch {
      return [];
    }
  }
}
