import { KeyoappScraper } from '../../../engine/keyoapp';
import type { CheerioAPI } from 'cheerio';
import type { Page, SearchResult } from '../../../engine/types';

export class RitharScansScraper extends KeyoappScraper {
  constructor() { super('RitharScans', 'https://ritharscans.com', 'en'); }

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
    const mangas = $('[wire:snapshot*=pages.search] button[tags]').toArray()
      .map(el => this.searchMangaFromElement($(el)));
    return { mangas, hasNextPage: false };
  }

  protected override pageListParse($: CheerioAPI): Page[] {
    const jsonLd = $('script[type="application/ld+json"]').first().html();
    if (!jsonLd) return [];
    try {
      const data = JSON.parse(jsonLd);
      const chapterId = data.url.substring(data.url.lastIndexOf('/') + 1);
      const seriesId = data.isPartOf.url.substring(data.isPartOf.url.lastIndexOf('/') + 1);
      return Array.from({ length: data.numberOfPages }, (_, i) => ({
        index: i,
        imageUrl: `${this.baseUrl}/storage/series/webtoon/${seriesId}/chapters/${chapterId}/${String(i + 1).padStart(3, '0')}.jpg`,
      }));
    } catch (err) {
      console.error(`Failed to parse JSON-LD for page list on ${this.name}: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
