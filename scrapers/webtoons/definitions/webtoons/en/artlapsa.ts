import { KeyoappScraper } from '../../../engine/keyoapp';
import type { CheerioAPI } from 'cheerio';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ArtlapsaScraper extends KeyoappScraper {
  constructor() { super('Art Lapsa', 'https://artlapsa.com', 'en'); }

  protected override readonly descriptionSelector: string = '#expand_content';
  protected override readonly statusSelector: string = 'a[aria-label=Status]';
  protected override readonly typeSelector: string = 'a[aria-label=Type]';
  protected override readonly genreSelector: string = "div:has(>h1) a[href*='/genres/']";
  protected override readonly authorSelector: string = 'dt:contains(Author) + dd';
  protected override readonly artistSelector: string = 'dt:contains(Artist) + dd';
  protected override readonly paidChapterSelector: string = 'img[alt~=Coin], img[src*=star-circle]';

  readonly altNameSelector = 'details[data-testid=series-other-names] li.select-all';

  // The home page only renders a fixed top-20 carousel, so use the paginated
  // search listing sorted by popularity instead (upstream ArtLapsa.kt).
  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/search?sort=popular&page=${page}`;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $(`main#main-content [wire\\:key*='serie']`).toArray()
      .map(el => this.searchMangaFromElement($(el)));
    return { mangas, hasNextPage: mangas.length >= 20 };
  }

  // The next page link is only rendered while more chapters exist (upstream).
  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/latest?page=${page}`);
    const $ = this.$(res.data);
    const mangas = $('div.grid > div.group').toArray()
      .map(el => this.popularMangaFromElement($(el)));
    const hasNextPage = $(`a[href*='?page=']`).length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (query.trim()) params.set('title', query.trim());
    const qs = params.toString();
    const url = qs ? `${this.baseUrl}/search?${qs}` : `${this.baseUrl}/search`;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $(`main#main-content [wire\\:key*='serie']`).toArray()
      .map(el => this.searchMangaFromElement($(el)));
    return { mangas, hasNextPage: mangas.length >= 20 };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('#chapters > a, #chapters > div').toArray()
      .map(el => $(el))
      .filter($el => {
        if ($el.find('.text-sm span:contains(Upcoming)').length > 0) return false;
        if ($el.text().includes('Upcoming')) {
          const marker = $el.find('.text-sm span').first().text().trim();
          if (marker.includes('Upcoming')) return false;
        }
        if (!this.showPaidChapters && $el.find(this.paidChapterSelector).length > 0) return false;
        return true;
      })
      .map($el => this.chapterFromElement($el));
  }

  protected override chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const ch = super.chapterFromElement($el);
    if ($el.find('img[alt=Coin], img[src*=star-circle]').length > 0 && !ch.name.startsWith('🔒')) {
      ch.name = `🔒 ${ch.name}`;
    }
    return ch;
  }

  // Covers are plain <img> tags since the site redesign (upstream).
  protected override getImageUrl($el: ReturnType<CheerioAPI>, _selector: string): string {
    const direct = $el.is('img') ? $el : $el.find(`img[alt$=' cover']`).first();
    const src = (direct.attr('src') || direct.attr('data-src') || '').trim();
    if (src) return this.absUrl(src);
    const fallback = $el.find('img').first();
    const fsrc = (fallback.attr('src') || fallback.attr('data-src') || '').trim();
    return fsrc ? this.absUrl(fsrc) : '';
  }

  protected override searchMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    return this.popularMangaFromElement($el);
  }

  protected override pageListParse($: CheerioAPI): Page[] {
    const xData = $('[x-data^=immersiveReader]').first().attr('x-data') ?? '';
    const startMarker = "JSON.parse('";
    const startIdx = xData.indexOf(startMarker);
    if (startIdx === -1) return [];
    const afterStart = xData.slice(startIdx + startMarker.length);
    const endIdx = afterStart.indexOf("')");
    if (endIdx === -1) return [];
    const pagesJs = afterStart.slice(0, endIdx);
    if (pagesJs.length === 0) {
      throw new Error('Log in via WebView and purchase this chapter to read.');
    }
    let pagesJson: string;
    try {
      pagesJson = JSON.parse(`"${pagesJs}"`);
    } catch {
      pagesJson = pagesJs;
    }
    try {
      const pages = JSON.parse(pagesJson) as Array<{ path: string }>;
      return pages.map((p, i) => ({ index: i, imageUrl: p.path }));
    } catch (err) {
      console.error(`Failed to parse immersiveReader pages on ${this.name}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
