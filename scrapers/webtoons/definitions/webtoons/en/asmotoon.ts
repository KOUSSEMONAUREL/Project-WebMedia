import { KeyoappScraper } from '../../../engine/keyoapp';
import type { Manga } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

export class AsmotoonScraper extends KeyoappScraper {
  constructor() { super('Asmodeus Scans', 'https://asmotoon.com', 'en'); }

  protected override readonly descriptionSelector: string = '#expand_content';
  protected override readonly genreSelector: string = '.gap-3 .gap-1 a';

  async getPopular(_page = 1) {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const mangas = $('div:contains(Trending) + div .group:not([data-type=novel])').toArray()
      .map(el => this.popularMangaFromElement($(el)));
    return { mangas, hasNextPage: false };
  }

  async getLatest(_page = 1) {
    const res = await this.get(`${this.baseUrl}/latest/`);
    const $ = this.$(res.data);
    const mangas = $('.group:not([data-type=novel])').toArray()
      .map(el => this.popularMangaFromElement($(el)));
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, _page = 1) {
    const url = `${this.baseUrl}/series/?q=${encodeURIComponent(query)}`;
    const res = await this.get(url);
    const $ = this.$(res.data);
    const mangas = $('.group:not([data-type=novel])').toArray()
      .filter(el => {
        const title = $(el).attr('title') || '';
        return title.toLowerCase().includes(query.toLowerCase());
      })
      .map(el => this.searchMangaFromElement($(el)));
    return { mangas, hasNextPage: false };
  }

  protected override mangaDetailsParse($: CheerioAPI, mangaUrl: string): Partial<Manga> {
    const manga = super.mangaDetailsParse($, mangaUrl);
    const mangaRecord = manga as Record<string, unknown>;
    const existingGenre = mangaRecord.genre as string | undefined;
    const genres: string[] = existingGenre ? existingGenre.split(', ') : [];
    const typeEl = $(this.typeSelector).first();
    const typeText = typeEl.text().trim();
    if (typeText) {
      const capitalized = typeText.charAt(0).toUpperCase() + typeText.slice(1).toLowerCase();
      genres.push(capitalized);
    }
    $(this.genreSelector).each((_, el) => {
      const g = $(el).text().replace(/,+$/, '').trim();
      if (g) genres.push(g);
    });
    mangaRecord.genre = genres.join(', ');
    return manga;
  }
}
