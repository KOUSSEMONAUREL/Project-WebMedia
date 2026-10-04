import { KeyoappScraper } from '../../../engine/keyoapp';
import type { CheerioAPI } from 'cheerio';
import type { Chapter, Page, SearchResult } from '../../../engine/types';

interface RitharPageDto {
  path: string;
}

export class RitharScansScraper extends KeyoappScraper {
  constructor() { super('RitharScans', 'https://ritharscans.com', 'en'); }

  protected override readonly statusSelector: string = 'a[aria-label=Status]';
  protected override readonly typeSelector: string = 'a[aria-label=Type]';
  protected override readonly genreSelector: string = "div:has(>h1) a[href*='/genres/']";
  protected override readonly authorSelector: string = 'dt:contains(Author) + dd';
  protected override readonly artistSelector: string = 'dt:contains(Artist) + dd';

  override async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/search?sort=popular&page=${page}`;
    const res = await this.get(url);
    return this.parseSearchManga(res.data);
  }

  override async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/latest?page=${page}`);
    const $ = this.$(res.data);
    const mangas = $('div.grid > div.group').toArray().map(el =>
      this.popularMangaFromElement($(el)),
    );
    const hasNextPage = $("a[href*='?page=']").length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    let url = `${this.baseUrl}/search`;
    const params: string[] = [];
    if (page > 1) params.push(`page=${page}`);
    if (query.trim()) params.push(`title=${encodeURIComponent(query.trim())}`);
    if (params.length > 0) url += `?${params.join('&')}`;
    const res = await this.get(url);
    return this.parseSearchManga(res.data);
  }

  private parseSearchManga(html: string): SearchResult {
    const $ = this.$(html);
    const mangas = $("main#main-content [wire\\:key*='serie']").toArray()
      .map(el => this.searchMangaFromElement($(el)));
    return { mangas, hasNextPage: mangas.length >= 20 };
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('#chapters a[href*="/read/"]').toArray()
      .map(el => $(el))
      .filter($el => {
        const card = $el.closest('.chapter-card');
        const scope = card.length > 0 ? card : $el;
        if (scope.find('.text-sm span').text().includes('Upcoming')) return false;
        if (scope.find(this.paidChapterSelector).length > 0) return false;
        return true;
      })
      .map($el => {
        const url = this.absUrl($el.attr('href') || '');
        const card = $el.closest('.chapter-card');
        const scope = card.length > 0 ? card : $el;
        const name = scope.find('.text-sm').first().text().trim() || $el.attr('aria-label') || $el.attr('title') || '';
        const hasPaidIcon = scope.find(this.paidChapterSelector).length > 0;
        return { name: hasPaidIcon ? `🔒 ${name}` : name, url };
      });
  }

  protected override getImageUrl($el: ReturnType<CheerioAPI>, _selector: string): string {
    const img = $el.find("img[alt$=' cover']").first();
    if (img.length === 0) return super.getImageUrl($el, _selector);
    const src = img.attr('src') || '';
    if (!src) return '';
    try {
      return new URL(src, this.baseUrl).toString();
    } catch {
      return src;
    }
  }

  protected override pageListParse($: CheerioAPI): Page[] {
    const xData = $('[x-data^=immersiveReader]').first().attr('x-data') || '';
    const pagesJs = xData.split("JSON.parse('")[1]?.split("')")[0] || '';
    if (!pagesJs) throw new Error('Log in via WebView and purchase this chapter to read.');
    let inner: string;
    try {
      inner = JSON.parse(`"${pagesJs}"`);
    } catch {
      inner = pagesJs;
    }
    const pages = JSON.parse(inner) as RitharPageDto[];
    return pages.map((page, i) => ({ index: i, imageUrl: page.path }));
  }
}
