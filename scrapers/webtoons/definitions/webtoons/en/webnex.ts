import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult, MangaStatus } from '../../../engine/types';
import { extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';

/**
 * Transcompilation of keiyoushi `en/webnex` (Webnex.kt).
 *
 * Next.js App Router site. Popular = /browse?sort=coverage, Latest =
 * /browse?sort=updated. The reader page's `pages` list lives in the RSC
 * flight payload; the site only server-renders the first few images, the
 * rest arrive in the hidden `div[id^="S:"]` chunks the client swaps into
 * `<template id="P:...">` placeholders — hence the asDocument surgery.
 */

type CheerioDoc = ReturnType<BaseScraper['$']>;

function parseStatus(text: string | undefined): MangaStatus {
  switch (text?.trim().toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    case 'dropped': return 2;
    default: return undefined;
  }
}

function isPlainTitle(cls: string | undefined): boolean {
  return (cls ?? '').split(/\s+/).includes('is-plain');
}

// Keep line breaks and links; descriptions render as Markdown.
function toMarkdown($: CheerioDoc, el: cheerio.Cheerio<Element>): string {
  let out = '';
  el.contents().each((_i, node) => {
    if (node.type === 'text') {
      out += (node as unknown as { data: string }).data;
      return;
    }
    if (node.type !== 'tag') return;
    const $tag = $(node);
    switch (node.name) {
      case 'br': out += '\n'; break;
      case 'a': {
        const href = $tag.attr('href') ?? '';
        out += `[${toMarkdown($, $tag).trim()}](${href})`;
        break;
      }
      case 'strong':
      case 'b': out += `**${toMarkdown($, $tag).trim()}**`; break;
      default: out += toMarkdown($, $tag);
    }
  });
  return out;
}

export class WebnexScraper extends BaseScraper {
  readonly name = 'Webnex';
  readonly baseUrl = 'https://webnex.cc';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse(page, '', 'coverage');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(page, '', 'updated');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.browse(page, query.trim(), undefined);
  }

  private async browse(page: number, query: string, sort?: string): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/browse`);
    if (query) url.searchParams.set('q', query);
    if (sort) url.searchParams.set('sort', sort);
    if (page > 1) url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    const $ = this.asDocument(String(res.data));
    const mangas: Manga[] = [];
    $('li.card-item a.card-link').each((_i, el) => {
      const $a = $(el);
      const href = $a.attr('href') ?? '';
      try {
        const segs = new URL(href, this.baseUrl).pathname.split('/').filter(Boolean);
        const slug = segs[1] ?? '';
        if (!slug) return;
        const title = $a.find('.card-title').first().text().trim();
        const thumb = $a.find('img.cover-img').first().attr('src') ?? '';
        mangas.push({ title, url: `/manga/${slug}`, thumbnailUrl: thumb, lang: this.lang });
      } catch {
        // skip malformed
      }
    });
    const hasNextPage = $('a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.asDocument(String(res.data));
    const title = $('h1.series-title').first().text().trim();
    const thumbnailUrl = $('.series-cover img').first().attr('src') ?? '';
    const author = $('.series-credits a[href*="author="]').map((_i, el) => $(el).text()).get().join(', ') || undefined;
    const artist = $('.series-credits a[href*="artist="]').map((_i, el) => $(el).text()).get().join(', ') || undefined;
    const genre = $('.series-facts a[href*="kind="], .tag-cloud a.chip').map((_i, el) => $(el).text()).get().join(', ') || undefined;
    const status = parseStatus($('.fact-status').first().text());
    let description = $('.series-desc p').map((_i, el) => toMarkdown($, $(el))).get().join('\n\n');
    const altTitles = $('details.series-more li').map((_i, el) => $(el).text()).get();
    if (altTitles.length > 0) {
      if (description.length > 0) description += '\n\n';
      description += 'Alternative titles:\n' + altTitles.map(t => `• ${t}`).join('\n');
    }
    return {
      title,
      url: this.relativizeMangaUrl(mangaUrl),
      thumbnailUrl,
      author,
      artist,
      genre,
      status,
      description: description.length > 0 ? description : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.asDocument(String(res.data));
    const groups: string[] = [];
    $('select[name="source"] option:not([value=""])').each((_i, el) => {
      const v = $(el).attr('value');
      if (v) groups.push(v);
    });
    const chapterLists: Chapter[][] = [];
    if (groups.length === 0) {
      chapterLists.push(await this.fetchChapters(mangaUrl, null, String(res.data)));
    } else {
      for (const g of groups) {
        chapterLists.push(await this.fetchChapters(mangaUrl, g, undefined));
      }
    }
    // Un manga expose plusieurs sources de chapitres (ici 8 : genz, asura,
    // vortex, manhuaplus, qi, kayn, hivetoons, thunder). Sans deduplication, un
    // media aux 31 chapitres recevait 272 lignes, dont 8 fois le meme chapitre.
    // On garde un chapitre par numero, en privilegiant une source dont le lecteur
    // sert reellement des pages : `genz` rend une coquille de 39 ko sans `<img>`
    // ni cle `pages`, la ou `manhuaplus` et `asura` exposent le payload complet.
    const all = chapterLists.flat();
    const byNumber = new Map<string, Chapter>();
    for (const c of all) {
      if (c.chapterNumber === undefined || Number.isNaN(c.chapterNumber)) continue;
      const key = `n${c.chapterNumber}`;
      const current = byNumber.get(key);
      if (!current) { byNumber.set(key, c); continue; }
      if (await this.sourceServesPages(c) && !await this.sourceServesPages(current)) byNumber.set(key, c);
    }
    const merged = byNumber.size > 0 ? [...byNumber.values()] : all;
    return merged.sort((a, b) => ((b.chapterNumber ?? 0) - (a.chapterNumber ?? 0)) || ((b.dateUpload ?? 0) - (a.dateUpload ?? 0)));
  }

  /**
   * Toutes les sources d'un manga ne servent pas les memes pages. Le verdict est
   * mis en cache : la liste des sources est courte et getChapterList est appele
   * sur les 60 medias d'un run.
   */
  private readonly pagesCache = new Map<string, boolean>();

  private async sourceServesPages(chapter: Chapter): Promise<boolean> {
    const cached = this.pagesCache.get(chapter.url);
    if (cached !== undefined) return cached;
    let serves = false;
    try {
      const res = await this.get(this.absUrl(chapter.url));
      serves = !!extractNextJsHtml(String(res.data), v => isJsonObject(v) && Array.isArray(v.pages));
    } catch {
      serves = false;
    }
    this.pagesCache.set(chapter.url, serves);
    return serves;
  }

  private async fetchChapters(mangaUrl: string, group: string | null, firstPageHtml?: string): Promise<Chapter[]> {
    const first = firstPageHtml !== undefined
      ? this.asDocument(firstPageHtml)
      : this.asDocument(String((await this.get(this.pageUrl(mangaUrl, group, 1))).data));
    const chapters = this.parseChapters(first);
    let lastPage = 1;
    first('.pagination-page a[href$="#chapters"]').each((_i, el) => {
      const n = parseInt(first(el as unknown as Element).text(), 10);
      if (!Number.isNaN(n) && n > lastPage) lastPage = n;
    });
    for (let page = 2; page <= lastPage; page++) {
      const $p = this.asDocument(String((await this.get(this.pageUrl(mangaUrl, group, page))).data));
      chapters.push(...this.parseChapters($p));
    }
    return chapters;
  }

  private pageUrl(mangaUrl: string, group: string | null, page: number): string {
    const url = new URL(this.absUrl(mangaUrl));
    if (group !== null) url.searchParams.set('source', group);
    if (page > 1) url.searchParams.set('page', String(page));
    return url.toString();
  }

  private parseChapters($: CheerioDoc): Chapter[] {
    const chapters: Chapter[] = [];
    $('li.ch-row').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('a.ch-link').first();
      const href = $link.attr('href') ?? '';
      let chapterId = '';
      try {
        const segs = new URL(href, this.baseUrl).pathname.split('/').filter(Boolean);
        chapterId = segs[segs.length - 1] ?? '';
      } catch {
        return;
      }
      if (!chapterId) return;
      const $num = $link.find('.ch-num').first();
      const $title = $link.find('.ch-title').first();
      const name = isPlainTitle($title.attr('class'))
        ? $title.text().trim()
        : [$num.text().trim(), $title.text().trim()].filter(s => s.length > 0).join(': ');
      // `.ch-num` contient un <span class="visually-hidden">"Chapter "</span>
      // AVANT le nombre. Un .text() brut donnait "Chapter 31" et
      // parseFloat("Chapter 31") valait NaN : chapterNumber restait undefined
      // sur toutes les series, donc le tri final ne triait rien.
      const numText = $num.clone().find('.visually-hidden').remove().end().text().trim();
      const chapterNumber = parseFloat(numText);
      const scanlator = $el.find('.ch-source, .ch-source-name').first().text().trim() || undefined;
      const datetime = $el.find('time.ch-time').first().attr('datetime');
      const dateUpload = datetime ? Date.parse(datetime) : NaN;
      chapters.push({
        name,
        url: `/read/${chapterId}`,
        chapterNumber: Number.isNaN(chapterNumber) ? undefined : chapterNumber,
        scanlator,
        dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const html = String(res.data);
    // Le predicat exigeait aussi une cle `chapter`, qui n'existe pas dans le payload :
    // l'objet du lecteur est `{id, title, href, group, pages}`. La condition
    // `pages` + tableau suffit, et elle ne vide plus le cache sur les sources
    // sans images.
    const value = extractNextJsHtml(html, v => isJsonObject(v) && Array.isArray(v.pages));
    if (!isJsonObject(value) || !Array.isArray(value.pages)) return [];
    const chapterAbs = this.absUrl(chapterUrl);
    const pages: Page[] = [];
    for (const p of value.pages as unknown[]) {
      const url = typeof p === 'string' ? p : '';
      if (!url) continue;
      pages.push({ index: pages.length, imageUrl: new URL(url, chapterAbs).toString() });
    }
    return pages;
  }

  // Mirror of Webnex.asDocument(): Next.js streams late chunks as hidden
  // divs the client swaps into <template> placeholders; do that swap
  // server-side so cheerio sees the real DOM.
  private asDocument(html: string): CheerioDoc {
    const $ = this.$(html);
    $('div[hidden]').each((_i, el) => {
      const $el = $(el);
      const id = $el.attr('id') ?? '';
      if (!id.startsWith('S:')) return;
      const suffix = id.slice(2);
      const placeholder = $(`template[id="P:${suffix}"]`).first();
      if (placeholder.length === 0) return;
      $el.contents().each((_j, node) => {
        placeholder.before(node);
      });
      placeholder.remove();
      $el.remove();
    });
    return $;
  }

  private relativizeMangaUrl(url: string): string {
    try {
      const u = new URL(url, this.baseUrl);
      const segs = u.pathname.split('/').filter(Boolean);
      return `/manga/${segs[segs.length - 1] ?? ''}`;
    } catch {
      return url;
    }
  }
}
