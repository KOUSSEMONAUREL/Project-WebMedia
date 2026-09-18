import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';

/**
 * Transcompilation of keiyoushi `fr/scanreader` (ScanReader multi-src).
 */
export class ScanreaderScraper extends BaseScraper {
  readonly name = 'Scan Reader';
  readonly baseUrl = 'https://scanreader.net';
  readonly lang = 'fr';

  private readonly onClickCoverRegex = /addToHistory\(\d+\s*,\s*'[^']*'\s*,\s*'([^']+)'/;
  private readonly imageArrayRegex = /(?:const|let|var)\s+\w+\s*=\s*\[((?:\s*"[A-Za-z0-9+/=]+"(?:\s*,\s*)?)+)\s*]/;
  private readonly imageItemRegex = /"([A-Za-z0-9+/=]{20,})"/g;

  async getPopular(page: number = 1): Promise<SearchResult> {
    const url = page > 1
      ? (page > 2 ? `${this.baseUrl}/bibliotheque/page/${page - 1}/?sort=views` : `${this.baseUrl}/bibliotheque/?sort=views`)
      : this.baseUrl;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const selector = page > 1 ? 'div.manga-card' : 'div.popular-section div.manga-card';
    const mangas = $(selector).toArray()
      .map(el => this.mangaFromCard($(el)))
      .filter((m): m is Manga => m !== null)
      .filter(m => !m.title.includes('(Novel)'));
    const hasNextPage = page > 1
      ? $('a.pagination-next').length > 0
      : mangas.length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const url = page > 1 ? `${this.baseUrl}/dernieres-sorties/page/${page}/` : `${this.baseUrl}/dernieres-sorties/`;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $('div.manga-cover').toArray()
      .map(el => this.mangaFromLatestCard($(el)))
      .filter((m): m is Manga => m !== null)
      .filter(m => !m.title.includes('(Novel)'));
    const hasNextPage = $('a.pagination-next').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, _page: number = 1): Promise<SearchResult> {
    const url = new URL(this.baseUrl + '/');
    url.searchParams.set('s', query.trim());
    url.searchParams.set('post_type', 'manga');
    const res = await this.get(url.toString());
    const $ = this.$(res.data);
    const mangas = $('div.manga-card').toArray()
      .map(el => this.mangaFromCard($(el)))
      .filter((m): m is Manga => m !== null)
      .filter(m => !m.title.includes('(Novel)'));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const url = this.absUrl(mangaUrl);
    const res = await this.get(url);
    const $ = this.$(res.data);
    const title = $('h1.manga-title').first().text().trim();
    const thumbMeta = $('meta[property="og:image"]').attr('content');
    const thumbLazy = this.extractLazySrc($('img.wp-post-image').first() as unknown as ReturnType<CheerioAPI>);
    const thumbnailUrl = thumbMeta && thumbMeta.length > 0 ? this.absUrl(thumbMeta) : thumbLazy || '';
    const description = $('div.manga-content div[style*="background: #333"] p').first().text().trim() || undefined;

    let author: string | undefined;
    let genre: string | undefined;
    let status: Manga['status'];

    $('div.manga-info-grid > div').each((_, el) => {
      const row = $(el);
      const label = row.find('div:first-child').first().text().trim().toLowerCase();
      const valueEl = row.find('div:last-child').first();
      if (!label || valueEl.length === 0) return;
      if (label.includes('auteur')) {
        author = valueEl.text().trim();
      } else if (label.includes('genres')) {
        genre = valueEl.find('span').toArray().map(s => $(s).text().trim()).filter(Boolean).join(', ');
      } else if (label.includes('statut')) {
        const t = valueEl.text().trim().toLowerCase();
        if (t.includes('cours')) status = 1;
        else if (t.includes('terminé')) status = 0;
        else if (t.includes('hiatus')) status = 2;
        else if (t.includes('licencié')) status = 3;
      }
    });

    return { title: title || undefined, url: mangaUrl, thumbnailUrl, description, author, genre, status, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.absUrl(mangaUrl);
    const res = await this.get(url);
    const $ = this.$(res.data);
    const container = $('#secure-chapters-container');
    if (container.length === 0) return [];
    const mangaId = container.attr('data-manga-id') || '';
    const nonce = container.attr('data-nonce') || '';
    if (!mangaId || !nonce) return [];

    const form = new FormData();
    form.append('action', 'load_protected_chapters_html');
    form.append('manga_id', mangaId);
    form.append('nonce', nonce);

    const ajaxRes = await this.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, form, {
      headers: {
        Referer: url,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const bodyStr: string = typeof ajaxRes.data === 'string' ? ajaxRes.data : JSON.stringify(ajaxRes.data);
    let html: string;
    try {
      const parsed = JSON.parse(bodyStr) as { data?: string; success?: boolean };
      html = parsed.data ?? bodyStr;
    } catch {
      html = bodyStr;
    }
    if (html.trim() === '0' || html.trim() === '-1') return [];

    const $$ = cheerio.load(html, undefined, false) as unknown as CheerioAPI;
    // Use cheerio with baseUrl for absUrl resolution – parseBodyFragment equivalent
    const chapters: Chapter[] = [];
    const h4s = $$(`h4`).toArray();
    for (const h4 of h4s) {
      const $h4 = $$(h4);
      // walk parents to find a[href*='/chapitre/']
      let href: string | null = null;
      let scanlator: string | undefined;
      let parent: ReturnType<CheerioAPI> | null = $h4.parent() as unknown as ReturnType<CheerioAPI>;
      // brute: search ancestors up to 5 levels
      let current: ReturnType<CheerioAPI> = $h4 as unknown as ReturnType<CheerioAPI>;
      for (let depth = 0; depth < 6; depth++) {
        const a = $$(current).find ? $$(current).find('a[href*="/chapitre/"]') : $$(`a[href*="/chapitre/"]`);
        // instead use closest ancestor search by traversing dom
        const candidate = $h4.parents().toArray().find(p => $$(p).find('a[href*="/chapitre/"]').length > 0);
        if (candidate) {
          href = $$(candidate).find('a[href*="/chapitre/"]').first().attr('href') || null;
          // scanlator
          const team = $$(candidate).find('a[title*="Team"]').first().text().trim();
          if (team) scanlator = team;
          break;
        }
        // fallback: direct parent check
        const direct = $h4.closest('a[href*="/chapitre/"]');
        if (direct.length > 0) {
          href = direct.attr('href') || null;
          break;
        }
        break;
      }
      if (!href) {
        // alternative: find nearest a sibling
        const nearest = $h4.prevAll('a[href*="/chapitre/"]').first();
        if (nearest.length > 0) href = nearest.attr('href') || null;
        else {
          const ancestor = $h4.parents().toArray().find(p => $$(p).find('a').length > 0);
          if (ancestor) href = $$(ancestor).find('a[href*="/chapitre/"]').first().attr('href') || null;
        }
      }
      if (!href) continue;
      const absHref = href.startsWith('http') ? href : this.absUrl(href);
      const name = $h4.text().trim();
      if (!name) continue;
      const dateText = ($h4.next().text() || '').trim();
      const dateUpload = this.parseFrenchDate(dateText);
      chapters.push({ name, url: absHref.replace(this.baseUrl, ''), scanlator, dateUpload });
    }
    return chapters;
  }

  private parseFrenchDate(text: string): number | undefined {
    if (!text) return undefined;
    // expected dd/MM/yyyy
    const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      const d = new Date(Date.UTC(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), 12, 0, 0));
      if (!isNaN(d.getTime())) return d.getTime();
    }
    const d2 = new Date(text);
    if (!isNaN(d2.getTime())) return d2.getTime();
    return undefined;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = this.absUrl(chapterUrl);
    const res = await this.get(url);
    const body: string = res.data as string;
    const arrayMatch = this.imageArrayRegex.exec(body);
    if (!arrayMatch) return [];
    const inner = arrayMatch[1];
    const regex = new RegExp(this.imageItemRegex.source, 'g');
    const pages: Page[] = [];
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = regex.exec(inner)) !== null) {
      const b64 = match[1];
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8').split('').reverse().join('');
        pages.push({ index: idx++, imageUrl: decoded });
      } catch {
        // skip
      }
    }
    return pages;
  }

  private extractCoverFromOnClick(onclick: string | undefined): string | null {
    if (!onclick) return null;
    const m = this.onClickCoverRegex.exec(onclick);
    return m ? m[1] : null;
  }

  private extractLazySrc($img: ReturnType<CheerioAPI>): string | null {
    if (!$img || $img.length === 0) return null;
    const dataLazy = $img.attr('data-lazy-src');
    if (dataLazy) return this.absUrl(dataLazy);
    const srcset = $img.attr('data-lazy-srcset');
    if (srcset) {
      const first = srcset.split(',')[0]?.trim().split(' ')[0];
      if (first) return this.absUrl(first);
    }
    const src = $img.attr('src');
    if (src && !src.startsWith('data:')) return this.absUrl(src);
    return null;
  }

  private mangaFromCard($el: ReturnType<CheerioAPI>): Manga | null {
    const link = $el.find('a').first();
    if (link.length === 0) return null;
    const title = $el.find('h3').first().text().trim();
    if (!title) return null;
    const href = link.attr('href') || '';
    const onclick = link.attr('onclick') || undefined;
    const cover = this.extractCoverFromOnClick(onclick);
    const lazy = this.extractLazySrc($el.find('img').first() as unknown as ReturnType<CheerioAPI>);
    return {
      title,
      url: this.absUrl(href).replace(this.baseUrl, ''),
      thumbnailUrl: cover ? this.absUrl(cover) : lazy || '',
      lang: this.lang,
    };
  }

  private mangaFromLatestCard($cover: ReturnType<CheerioAPI>): Manga | null {
    const a = $cover.find('a').first();
    const url = a.attr('href');
    if (!url) return null;
    const next = $cover.next();
    const title = next.find('h3.manga-title-display').first().text().trim() || $cover.find('h3').first().text().trim();
    if (!title) return null;
    const thumb = this.extractLazySrc($cover.find('img').first() as unknown as ReturnType<CheerioAPI>);
    return {
      title,
      url: this.absUrl(url).replace(this.baseUrl, ''),
      thumbnailUrl: thumb || '',
      lang: this.lang,
    };
  }
}
