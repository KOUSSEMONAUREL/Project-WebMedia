import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

type CheerioQuery = ReturnType<BaseScraper['$']>;
type CheerioInput = Parameters<CheerioQuery>[0];

// Transcompilation of keiyoushi src/en/mangafreak (Mangafreak.kt, KeiSource,
// libVersion 1.6). The previous port was a generic stub (bare `a`/`img`
// selectors, empty latest/search); this follows the upstream endpoints and
// selectors exactly, including the #404 change: latest issues come from the
// site's `Latest_Releases` page (`div.latest_releases_item`) because the
// homepage mixes today's, yesterday's and older titles.
const FLOAT_LETTER_PATTERN = /(\d+)(\.\d+|[a-i]+\b)?/;

function parseChapterNumber(name: string): number {
  const match = FLOAT_LETTER_PATTERN.exec(name);
  if (!match) return -1;
  const frac = match[2] ?? '';
  if (frac === '' || frac[0] === '.') return parseFloat(match[0]);
  let decimals = '0.';
  for (const ch of frac) decimals += String(ch.charCodeAt(0) - 'a'.charCodeAt(0) + 1);
  return parseFloat(match[1]) + parseFloat(decimals);
}

function parseUtcDate(value: string): number | undefined {
  const parts = value.trim().split('/');
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return undefined;
  return Date.UTC(y, m - 1, d);
}

function absolutizeThumbnail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] === 'mini_images' && segments.length >= 2) {
    return `${url.origin}/manga_images/${segments[1]}.jpg`;
  }
  return raw;
}

export class MangafreakScraper extends BaseScraper {
  readonly name = 'Mangafreak';
  readonly baseUrl = 'https://mangafreak.com';
  readonly lang = 'en';

  private mangaFromElement($: CheerioQuery, el: unknown, urlSelector: string): Manga {
    const $el = $(el as CheerioInput);
    const link = $el.find(urlSelector).first();
    const href = link.attr('href') ?? '';
    // Upstream reads `abs:src` raw (no lazy-load handling on this site).
    const thumb = $el.find('img').first().attr('src');
    return {
      title: link.text().trim(),
      url: this.absUrl(href).replace(this.baseUrl, ''),
      thumbnailUrl: thumb ? this.absUrl(thumb) : '',
      lang: this.lang,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/Genre/All/${page}`);
    const $ = this.$(res.data);
    const mangas = $('div.ranking_item')
      .toArray()
      .map((el) => this.mangaFromElement($, el, 'a'));
    return { mangas, hasNextPage: $('a.next_p').length > 0 };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = page === 1 ? `${this.baseUrl}/Latest_Releases` : `${this.baseUrl}/Latest_Releases/${page}`;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $('div.latest_releases_item')
      .toArray()
      .map((el) => {
        const $el = $(el);
        const link = $el.find('a').first();
        const href = link.attr('href') ?? '';
        const rawThumb = $el.find('img').first().attr('src');
        return {
          title: link.text().trim(),
          url: this.absUrl(href).replace(this.baseUrl, ''),
          thumbnailUrl: absolutizeThumbnail(rawThumb ? this.absUrl(rawThumb) : undefined) ?? '',
          lang: this.lang,
        } as Manga;
      });
    return { mangas, hasNextPage: $('a.next_p').length > 0 };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    // Our engine has no tri-state genre filter UI; filter-less blank search
    // would hit the homepage (no result nodes upstream), so fall back to
    // popular like the other directory scrapers do.
    if (!query.trim()) return this.getPopular(1);
    const res = await this.get(`${this.baseUrl}/Find/${encodeURIComponent(query.trim())}`);
    const $ = this.$(res.data);
    const mangas = $('div.manga_search_item, div.mangaka_search_item')
      .toArray()
      .map((el) => this.mangaFromElement($, el, 'h3 a, h5 a'));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const dataCells = $('div.manga_series_data').children('div');
    const status = dataCells.eq(2).text().trim().toLowerCase();
    return {
      title: $('div.manga_series_data h5').text().trim(),
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('div.manga_series_image img').first().attr('src') ?? ''),
      author: dataCells.eq(3).text().trim() || undefined,
      artist: dataCells.eq(4).text().trim() || undefined,
      genre: $('div.series_sub_genre_list a').map((_i, el) => $(el).text().trim()).get().join(', ') || undefined,
      description: $('div.manga_series_description p').text().trim() || undefined,
      status: status === 'on-going' || status === 'ongoing' ? 1 : status === 'completed' ? 0 : 3,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters = $('div.manga_series_list tr:has(a)')
      .toArray()
      .map((el) => {
        const $el = $(el);
        const cells = $el.find('td');
        const name = cells.eq(0).text().trim();
        const link = $el.find('a').first().attr('href') ?? '';
        return {
          name,
          url: this.absUrl(link).replace(this.baseUrl, ''),
          chapterNumber: parseChapterNumber(name),
          dateUpload: parseUtcDate(cells.eq(1).text()),
        } as Chapter;
      });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('img#gohere[src]')
      .toArray()
      .map((el, index) => ({
        index,
        imageUrl: this.absUrl($(el).attr('src') ?? ''),
      }));
  }
}
