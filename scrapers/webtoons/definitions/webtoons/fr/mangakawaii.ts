import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const RELATIVE_DATE_REGEX = /il y a (\d+)\s*([a-zéû.]+)/;
const CHAPTER_NUMBER_REGEX = /Ch\.\s*(\d+)/;
const IMAGES_REGEX = /"imgs":\s*\[(.*?)]/s;

export class MangakawaiiScraper extends BaseScraper {
  readonly name = 'Mangakawaii';
  readonly baseUrl = 'https://www.mangakawaii.fr';
  readonly lang = 'fr';

  private parseMangaCards(html: string): Manga[] {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('a.mk-card[href*="/manga/"]').each((_, el) => {
      const $el = $(el);
      const img = $el.find('img').first();
      const title = $el.find('p.mk-display').first().text().trim() || (img.attr('alt') ?? '').trim();
      if (!title) return;
      const href = $el.attr('href') ?? '';
      if (!href) return;
      const thumbnailUrl = img.attr('src') ? this.absUrl(img.attr('src') ?? '') : '';
      mangas.push({ title, url: this.absUrl(href), thumbnailUrl, lang: this.lang });
    });
    // deduplicate by url
    const seen = new Set<string>();
    return mangas.filter((m) => {
      if (seen.has(m.url)) return false;
      seen.add(m.url);
      return true;
    });
  }

  private hasNextPage(html: string, page: number): boolean {
    const $ = this.$(html);
    const re = new RegExp(`[?&]page=${page + 1}(?:[&#]|$)`);
    let found = false;
    $('nav[aria-label="Pagination"] a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (re.test(href)) found = true;
    });
    return found;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/mangas?sort=views&page=${page}`;
    const res = await this.get(url);
    const html = res.data as string;
    return { mangas: this.parseMangaCards(html), hasNextPage: this.hasNextPage(html, page) };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/mangas?sort=last_updated&dir=desc&page=${page}`;
    const res = await this.get(url);
    const html = res.data as string;
    return { mangas: this.parseMangaCards(html), hasNextPage: this.hasNextPage(html, page) };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = query.trim() === ''
      ? `${this.baseUrl}/mangas?page=${page}`
      : `${this.baseUrl}/recherche?q=${encodeURIComponent(query)}&page=${page}`;
    const res = await this.get(url);
    const html = res.data as string;
    return { mangas: this.parseMangaCards(html), hasNextPage: this.hasNextPage(html, page) };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    // Reuse parseDetails logic
    const title = $('h1').first().text().trim();
    const thumbnailUrl = $('img.shadow-2xl').first().attr('src') ? this.absUrl($('img.shadow-2xl').first().attr('src') ?? '') : '';
    const description = $('[x-ref=desc]').first().text().trim() || undefined;

    const authors: string[] = [];
    const artists: string[] = [];
    let inArtists = false;
    const penNib = $('p:has(i.fa-pen-nib)').first();
    if (penNib.length) {
      penNib.children().each((_, node) => {
        const $node = $(node);
        const tag = (node as unknown as { tagName?: string }).tagName?.toLowerCase() ?? $node.prop('tagName')?.toLowerCase() ?? '';
        if (tag === 'i' && $node.hasClass('fa-paintbrush')) {
          inArtists = true;
        } else if (tag === 'a') {
          const txt = $node.text().trim();
          if (txt) {
            if (inArtists) artists.push(txt);
            else authors.push(txt);
          }
        }
      });
    }
    const author = [...new Set(authors)].join(', ') || undefined;
    const artist = [...new Set(artists)].join(', ') || undefined;
    const genre = $('a[href*=genres]').map((_, el) => $(el).text().trim()).get().filter(Boolean).join(', ') || undefined;

    const info = $('details p');
    let status: Manga['status'];
    const statusText = info.first().text().split('·').pop()?.trim().toLowerCase() ?? '';
    if (statusText === 'en cours') status = 1;
    else if (statusText === 'terminé') status = 0;
    else status = undefined;

    const altNames = info.eq(1).text().trim();
    let finalDescription = description;
    if (altNames) {
      finalDescription = finalDescription ? `${finalDescription}\n\nAlternative Titles:\n${altNames}` : `Alternative Titles:\n${altNames}`;
    }

    // Ensure url is preserved
    return {
      title: title || undefined,
      url: mangaUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      description: finalDescription,
      author,
      artist,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const html = res.data as string;
    const $ = this.$(html);
    const chaptersUrlAttr = $('[data-url*=chapitres]').first().attr('data-url');
    let chaptersBaseUrl: string;
    if (chaptersUrlAttr) {
      chaptersBaseUrl = chaptersUrlAttr.startsWith('http') ? chaptersUrlAttr : this.absUrl(chaptersUrlAttr);
    } else {
      const loc = mangaUrl.endsWith('/') ? mangaUrl.slice(0, -1) : mangaUrl;
      chaptersBaseUrl = `${loc}/chapitres`;
    }

    const chapters: Chapter[] = [];
    const firstRows = $('div.ch-row').toArray();
    this.parseChapterRowsHtml(res.data as string, chapters);

    let page = firstRows.length === 0 ? 1 : 2;
    const base = chaptersBaseUrl;
    // For mangakawaii, chapters are paginated via ?page=
    // Limit to prevent infinite loop
    for (let iter = 0; iter < 5; iter++) {
      const pageUrl = base.includes('?') ? `${base}&page=${page}` : `${base}?page=${page}`;
      try {
        const pageRes = await this.get(pageUrl);
        const pageHtml = pageRes.data as string;
        const $page = this.$(pageHtml);
        const rows = $page('div.ch-row').toArray();
        if (rows.length === 0) break;
        const before = chapters.length;
        this.parseChapterRowsHtml(pageHtml, chapters);
        if (chapters.length === before) break;
        page++;
      } catch {
        break;
      }
    }
    return chapters;
  }

  private parseChapterRowsHtml(html: string, out: Chapter[]): void {
    const $ = this.$(html);
    $('div.ch-row').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a.ch-num').first();
      if (!link.length) return;
      const href = link.attr('href') ?? '';
      if (!href) return;
      const name = link.text().trim();
      const numMatch = CHAPTER_NUMBER_REGEX.exec(name);
      const chapterNumber = numMatch ? parseFloat(numMatch[1]) : undefined;
      const dateText = $el.find('p').first().text().trim();
      const dateUpload = this.parseRelativeDate(dateText);
      out.push({
        name,
        url: this.absUrl(href),
        chapterNumber,
        dateUpload: dateUpload || undefined,
      });
    });
  }

  private parseRelativeDate(text: string): number {
    const clean = text.trim().toLowerCase();
    if (!clean) return 0;
    if (clean.includes('instant')) return Date.now();
    const match = RELATIVE_DATE_REGEX.exec(clean);
    if (!match) return 0;
    const value = parseInt(match[1], 10);
    if (isNaN(value)) return 0;
    const unit = match[2].replace(/\.$/, '');
    const d = new Date();
    if (['s', 'sec', 'seconde', 'secondes'].includes(unit)) d.setSeconds(d.getSeconds() - value);
    else if (['min', 'minute', 'minutes'].includes(unit)) d.setMinutes(d.getMinutes() - value);
    else if (['h', 'heure', 'heures'].includes(unit)) d.setHours(d.getHours() - value);
    else if (['j', 'jour', 'jours'].includes(unit)) d.setDate(d.getDate() - value);
    else if (['sem', 'semaine', 'semaines'].includes(unit)) d.setDate(d.getDate() - value * 7);
    else if (unit === 'mois') d.setMonth(d.getMonth() - value);
    else if (['an', 'ans', 'année', 'années', 'annee', 'annees'].includes(unit)) d.setFullYear(d.getFullYear() - value);
    else return 0;
    return d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const html = res.data as string;
    const $ = this.$(html);
    let state = $('[x-data*=imgs]').first().attr('x-data') ?? '';
    if (state) {
      let prev: string;
      do {
        prev = state;
        state = state
          .replace(/\\\\/g, '\\')
          .replace(/\\u0022/g, '"')
          .replace(/\\u0026/g, '&')
          .replace(/\\\//g, '/');
      } while (state !== prev);
      const match = IMAGES_REGEX.exec(state);
      if (match) {
        const imagesJson = match[1];
        try {
          const urls = JSON.parse(`[${imagesJson}]`) as string[];
          const filtered = urls.filter((u) => !u.includes('__mk_trap__')).filter((v, i, a) => a.indexOf(v) === i);
          if (filtered.length > 0) {
            return filtered.map((url, idx) => ({ index: idx, imageUrl: url }));
          }
        } catch {
          // fallback to img tags
        }
      }
    }
    // fallback
    const pages: Page[] = [];
    $('img[id^=pg-]').each((i, el) => {
      const src = $(el).attr('src') ?? '';
      if (!src) return;
      const abs = this.absUrl(src);
      if (abs) pages.push({ index: pages.length, imageUrl: abs });
    });
    // also try generic fallback for any images if no pg- found
    if (pages.length === 0) {
      $('img[src*="cdn"]').each((_, el) => {
        const src = $(el).attr('src') ?? '';
        if (src && src.includes('/i/manga/')) {
          const abs = this.absUrl(src);
          if (abs && !pages.some((p) => p.imageUrl === abs)) {
            pages.push({ index: pages.length, imageUrl: abs });
          }
        }
      });
    }
    return pages;
  }
}
