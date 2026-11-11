import { MangaThemesiaScraper } from '../../../engine/mangathemesia';
import type { CheerioAPI } from 'cheerio';
import type { Chapter, Page, SearchResult } from '../../../engine/types';

const SITE_LANGUAGE = 'Ingles';

export class LectorHentaiScraper extends MangaThemesiaScraper {
  constructor() {
    super('Lector Hentai', 'https://lectorhentai.com', 'all');
  }

  private listUrl(page: number, query = '', order = ''): string {
    const params = new URLSearchParams();
    if (query) params.set('s', query);
    params.set('lenguaje', SITE_LANGUAGE);
    params.set('page', String(page));
    if (order) params.set('order', order);
    return `${this.baseUrl}/tipo/all?${params.toString()}`;
  }

  private async fetchList(page: number, query = '', order = ''): Promise<SearchResult> {
    const res = await this.get(this.listUrl(page, query, order));
    return this.searchMangaParse(res.data);
  }

  override async getPopular(page = 1): Promise<SearchResult> {
    return this.fetchList(page, '', 'popular');
  }

  override async getLatest(page = 1): Promise<SearchResult> {
    return this.fetchList(page, '', 'latest');
  }

  override async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.fetchList(page, query.trim());
  }

  protected override searchMangaFromElement($el: ReturnType<CheerioAPI>) {
    const manga = super.searchMangaFromElement($el);
    const title = $el.find('.tt').first().text().trim() || manga.title;
    return { ...manga, title };
  }

  protected override get seriesTitleSelector(): string {
    return 'div.wd-full:has(b:contains(Título)) span';
  }

  protected override get seriesAuthorSelector(): string {
    return 'div.wd-full:has(b:contains(Artista)) span.mgen';
  }

  protected override get seriesArtistSelector(): string {
    return 'div.wd-full:has(b:contains(Artista)) span.mgen';
  }

  protected override get seriesGenreSelector(): string {
    return 'div.wd-full:has(b:contains(Generos)) a, div.wd-full:has(b:contains(Tags)) a';
  }

  protected override get seriesThumbnailSelector(): string {
    return '.thumbook .thumb img, .thumb img';
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const href = $('a.leer').first().attr('href') || '';
    if (!href) return [];
    return [{
      name: 'Chapter',
      url: this.absUrl(href),
      chapterNumber: 0,
    }];
  }

  override async getPageList(_chapterUrl: string): Promise<Page[]> {
    throw new Error('Lector Hentai: getPageList() not implemented (encrypted ReaderBlob payload)');
  }
}

export default LectorHentaiScraper;
