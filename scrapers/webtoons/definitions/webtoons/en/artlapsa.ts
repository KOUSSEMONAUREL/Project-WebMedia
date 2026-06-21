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
    const mangas = $(`main#main-content [wire:key*='serie']`).toArray()
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
