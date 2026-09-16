import { KeyoappScraper } from '../../../engine/keyoapp';
import type { CheerioAPI } from 'cheerio';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ArtlapsaScraper extends KeyoappScraper {
  constructor() { super('Art Lapsa', 'https://artlapsa.com', 'en'); }

  protected override readonly descriptionSelector: string = '#expand_content';
  protected override readonly statusSelector: string = '[alt=Status]';
  protected override readonly typeSelector: string = '[alt=Type]';

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await super.getPopular(_page);
    const seen = new Set<string>();
    res.mangas = res.mangas.filter(m => {
      const key = m.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    res.hasNextPage = false;
    return res;
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/search?title=${encodeURIComponent(query)}`;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $(`main#main-content [wire\\:key*='serie']`).toArray()
      .map(el => this.searchMangaFromElement($(el)));
    return { mangas, hasNextPage: mangas.length >= 20 };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const selector = this.showPaidChapters
      ? '#chapters > div:not(:has(.text-sm span:matches(Upcoming)))'
      : '#chapters > div:not(:has(.text-sm span:matches(Upcoming))):not(:has(img[alt=Coin], img[src*=star-circle]))';
    return $(selector).toArray()
      .map(el => $(el))
      .map($el => this.chapterFromElement($el));
  }

  protected override chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const ch = super.chapterFromElement($el);
    if ($el.find('img[alt=Coin], img[src*=star-circle]').length > 0 && !ch.name.startsWith('\uD83D\uDD12')) {
      ch.name = `\uD83D\uDD12 ${ch.name}`;
    }
    return ch;
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
