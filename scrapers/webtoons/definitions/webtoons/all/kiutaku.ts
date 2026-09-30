import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio } from 'cheerio';

/**
 * Transcompilation of keiyoushi `all/kiutaku` (Kiutaku.kt).
 *
 * Cosplay gallery source. Each entry is a photo set: the "chapters" upstream
 * exposes are the article's own image-pagination links, so a 5-page gallery
 * yields five chapters named "Page N", each holding a batch of images.
 *
 * The image host (mitaku.net) refuses hotlinking when the request carries a
 * kiutaku.com Referer, so every request here drops that header, exactly as
 * upstream's `configureHeaders()` does.
 *
 * One deliberate divergence: upstream searches with `?search=`, which the site
 * now ignores (it answers 200 with an empty grid). The working parameter is
 * WordPress' native `?s=`. `?search=` is kept as a fallback below.
 */

export class KiutakuScraper extends BaseScraper {
  readonly name = 'Kiutaku';
  readonly baseUrl = 'https://kiutaku.com';
  readonly lang = 'all';

  private getPage(page: number): number {
    return (page - 1) * 20;
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/hot?start=${this.getPage(page)}`);
    return this.parseMangaList(res.data);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/?start=${this.getPage(page)}`);
    return this.parseMangaList(res.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    const start = this.getPage(page);
    const params = new URLSearchParams({ s: term, start: String(start) });
    const res = await this.get(`${this.baseUrl}/?${params.toString()}`);
    let result = this.parseMangaList(res.data);
    if (result.mangas.length > 0) return result;
    // Fall back to the upstream parameter in case the site reverts.
    const legacy = new URLSearchParams({ search: term, start: String(start) });
    const fallback = await this.get(`${this.baseUrl}/?${legacy.toString()}`);
    result = this.parseMangaList(fallback.data);
    return result;
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.blog > div.items-row').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('a.item-link').first();
      const href = $link.attr('href');
      if (!href) return;
      mangas.push({
        title: $el.find('h2').first().text().trim() || 'Cosplay',
        url: this.stripDomain(href),
        thumbnailUrl: this.imgAttr($el.find('img').first()),
        lang: this.lang,
        // Galleries never "continue": upstream pins every entry to COMPLETED
        // with an ONLY_FETCH_ONCE strategy.
        status: 0,
      });
    });
    const hasNextPage = $('nav > a.pagination-next:not([disabled])').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    const title = $('div.article-header').first().text().trim();
    const genre = $('div.article-tags a.tag > span')
      .toArray()
      .map(s => $(s).text().trim().replace(/^#/, ''))
      .filter(Boolean)
      .join(', ');
    const cosplayer = $('div.article-info').eq(1).text().replace(/^Cosplayer:\s*/, '').trim();
    const date = $('div.article-info small').first().text().replace(/[^\d: -]/g, '').trim();
    return {
      title,
      url: this.stripDomain(mangaUrl),
      thumbnailUrl: this.imgAttr($('div.article-fulltext img').first()),
      genre: genre || undefined,
      description: cosplayer ? `Cosplayer: ${cosplayer}` : undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    // The first pagination nav on the article is the gallery's own page links.
    $('nav.pagination:first-of-type a').each((_i, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      const label = $el.text().trim();
      if (!href || !label || !/^\d+$/.test(label)) return;
      chapters.push({
        name: `Page ${label}`,
        url: this.stripDomain(href),
        // Upstream defaults an unparsable page number to 1F.
        chapterNumber: Number(label) || 1,
      });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl), { headers: { Referer: '' } });
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('div.article-fulltext img[src]').each((index, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private imgAttr($el: Cheerio<any>): string {
    if (!$el || !$el.length) return '';
    return this.absUrl(($el.attr('src') as string) || ($el.attr('data-src') as string) || '');
  }

  private stripDomain(href: string): string {
    try {
      const u = new URL(href, this.baseUrl);
      return u.pathname + u.search;
    } catch {
      return href;
    }
  }
}