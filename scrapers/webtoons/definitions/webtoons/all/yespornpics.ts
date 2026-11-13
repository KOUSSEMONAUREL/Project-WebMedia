import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

export class YesPornPicsScraper extends BaseScraper {
  readonly name = 'YesPornPics';
  readonly baseUrl = 'https://yespornpics.com';
  readonly lang = 'all';

  private cleanTitle(value: string): string {
    return value
      .replace(/^yes!\s*/i, '')
      .replace(/^yes porn pics\s*/i, '')
      .replace(/\s+XXX Sex Gallery\s*#\s*\d+\s*$/i, '')
      .replace(/\s+porn pics\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private listUrl(page: number): string {
    return page > 1 ? `${this.baseUrl}/sex/${page}` : `${this.baseUrl}/`;
  }

  private parseList($: CheerioAPI): SearchResult {
    const mangas: Manga[] = [];
    $("div.gallery > a[href^='/sex/']").each((_, element) => {
      const link = $(element);
      const href = link.attr('href') ?? '';
      const img = link.find('img').first();
      const title = this.cleanTitle(link.attr('title') ?? img.attr('alt') ?? '');
      if (!href || !title) return;

      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(img.attr('src') ?? ''),
        lang: this.lang,
      });
    });

    const hasNextPage = $('a').filter((_, element) => $(element).text().trim().toLowerCase() === 'next').length > 0;
    return { mangas, hasNextPage };
  }

  private async getList(url: string): Promise<SearchResult> {
    const res = await this.get(url);
    return this.parseList(this.$(res.data));
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getLatest(page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getList(this.listUrl(page));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return this.getLatest(page);

    const suffix = page > 1 ? `&page=${page}` : '';
    const res = await this.get(`${this.baseUrl}/search.php?model=${encodeURIComponent(trimmed)}${suffix}`);
    const result = this.parseList(this.$(res.data));
    return { mangas: result.mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const rawTitle = $("meta[property='og:title']").attr('content') ?? $('title').first().text();
    const title = this.cleanTitle(rawTitle);
    const thumbnailUrl = $("meta[property='og:image']").attr('content') ?? $('img').first().attr('src') ?? '';
    const description = $("meta[property='og:description']").attr('content') ?? $("meta[name='description']").attr('content') ?? '';

    const genres: string[] = [];
    $("div.gallerytags a[href^='/sex/']").each((_, element) => {
      const genre = $(element).text().replace(/\s+/g, ' ').trim();
      if (genre) genres.push(genre);
    });

    return {
      title: title || undefined,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: this.absUrl(thumbnailUrl),
      genre: [...new Set(genres)].join(', ') || undefined,
      description: description.replace(/\s+/g, ' ').trim() || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{
      name: 'Gallery',
      url: this.absUrl(mangaUrl),
      chapterNumber: 1,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    const images: string[] = [];
    const seen = new Set<string>();
    $('div.jpeg a[href]').each((_, element) => {
      const src = $(element).attr('href') ?? '';
      if (!src || seen.has(src)) return;
      seen.add(src);
      images.push(this.absUrl(src));
    });

    return images.map((imageUrl, index) => ({ imageUrl, index }));
  }
}
