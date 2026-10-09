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
 *
 * Chapter listing follows upstream: each `li.ch-row` is one chapter (the
 * upload the site picked) plus the other groups' uploads in its
 * `.ch-sources-menu` dropdown. There is no more per-`source` group fetching
 * (`select[name=source]` is gone from the page); pagination is `?page=N`.
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

// Largest first, as the site's timeAgo() checks them (upstream Webnex.TIME_AGO_UNITS).
const TIME_AGO_UNITS: Array<[string, number]> = [
  ['y', 365 * 86400000],
  ['mo', 30 * 86400000],
  ['w', 7 * 86400000],
  ['d', 86400000],
  ['h', 3600000],
  ['m', 60000],
];

// Upstream reads `pathSegments[1]` (`/read/<id>`); fall back to the last
// non-empty segment so odd hrefs still resolve instead of vanishing.
function chapterIdFromHref(href: string, baseUrl: string): string {
  try {
    const segs = new URL(href, baseUrl).pathname.split('/').filter(Boolean);
    return segs[1] ?? segs[segs.length - 1] ?? '';
  } catch {
    return '';
  }
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
    const first = this.asDocument(String(res.data));
    let lastPage = 1;
    first('.pagination-page a[href$="#chapters"]').each((_i, el) => {
      const n = parseInt(first(el as unknown as Element).text(), 10);
      if (!Number.isNaN(n) && n > lastPage) lastPage = n;
    });
    const docs: CheerioDoc[] = [first];
    if (lastPage > 1) {
      const rest = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, i) => i + 2).map(async page =>
          this.asDocument(String((await this.get(this.pageUrl(mangaUrl, page))).data)),
        ),
      );
      docs.push(...rest);
    }
    // Groups are listed one after another, so interleave them by number and then date.
    const chapters = docs.flatMap(d => this.parseChapters(d));
    return chapters.sort((a, b) => ((b.chapterNumber ?? 0) - (a.chapterNumber ?? 0)) || ((b.dateUpload ?? 0) - (a.dateUpload ?? 0)));
  }

  // Inverts the site's timeAgo(): "4w ago" means 4 weeks up to the 30 days
  // where "1mo" takes over, so take the middle (upstream Webnex.parseTimeAgo).
  private parseTimeAgo(text: string | undefined): number | undefined {
    if (text === undefined) return undefined;
    if (text === 'just now') return Date.now();
    const match = /^(\d+)(mo|y|w|d|h|m) ago$/.exec(text);
    if (!match) return undefined;
    const count = parseInt(match[1], 10);
    const idx = TIME_AGO_UNITS.findIndex(([suffix]) => suffix === match[2]);
    if (idx === -1) return undefined;
    const unit = TIME_AGO_UNITS[idx][1];
    const larger = idx === 0 ? Number.POSITIVE_INFINITY : TIME_AGO_UNITS[idx - 1][1];
    const upper = Math.min(unit * (count + 1), larger);
    return Date.now() - (unit * count + upper) / 2;
  }

  private pageUrl(mangaUrl: string, page: number): string {
    const url = new URL(this.absUrl(mangaUrl));
    if (page > 1) url.searchParams.set('page', String(page));
    return url.toString();
  }

  // Each row is one chapter: the upload the site picked, plus the other
  // groups' uploads in its dropdown (upstream Webnex.parseChapters).
  // Upstream keeps the dropdown dates estimated when first seen via a
  // `knownDates` cache carried by the app; this port is stateless, so every
  // dropdown upload is dated from its relative `.ch-sources-time` label.
  private parseChapters($: CheerioDoc): Chapter[] {
    const chapters: Chapter[] = [];
    $('li.ch-row').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('a.ch-link').first();
      const href = $link.attr('href') ?? '';
      const pickedId = chapterIdFromHref(href, this.baseUrl);
      if (!pickedId) return;
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
        url: `/read/${pickedId}`,
        chapterNumber: Number.isNaN(chapterNumber) ? undefined : chapterNumber,
        scanlator,
        dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
      });
      $el.find('.ch-sources-menu a.ch-sources-item').each((_j, item) => {
        const $item = $(item);
        const itemId = chapterIdFromHref($item.attr('href') ?? '', this.baseUrl);
        if (!itemId) return;
        const itemScanlator = $item.find('.ch-sources-name').first().text().trim() || undefined;
        const itemDate = this.parseTimeAgo($item.find('.ch-sources-time').first().text().trim() || undefined);
        chapters.push({
          name,
          url: `/read/${itemId}`,
          chapterNumber: Number.isNaN(chapterNumber) ? undefined : chapterNumber,
          scanlator: itemScanlator,
          dateUpload: itemDate,
        });
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
