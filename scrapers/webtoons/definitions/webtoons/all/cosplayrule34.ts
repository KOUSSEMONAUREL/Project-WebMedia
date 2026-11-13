import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

export class CosplayRule34Scraper extends BaseScraper {
  readonly name = 'CosplayRule34';
  readonly baseUrl = 'https://cosplayrule34.com';
  readonly lang = 'all';

  private readonly searchCache = new Map<string, string>();

  private listUrl(page: number, path = ''): string {
    const base = `${this.baseUrl}${path || '/'}`;
    return page > 1 ? `${base}?page=${page}` : base;
  }

  private parseCards($: CheerioAPI): { mangas: Manga[]; total: number } {
    const mangas: Manga[] = [];
    let total = 0;

    $("div.grid-item[onclick*='/post/']").each((_, element) => {
      const card = $(element);
      const onclick = card.attr('onclick') ?? '';
      const href =
        card.find("a[href^='/post/']").first().attr('href') ??
        /location\.href='([^']+)'/.exec(onclick)?.[1] ??
        '';
      const title = card.find("a[href^='/post/']").first().text().replace(/\s+/g, ' ').trim();
      if (!href || !title) return;

      const style = card.attr('style') ?? '';
      const background = /background-image:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(style)?.[1];
      const thumbnailUrl = card.find('img').first().attr('src') ?? background ?? '';

      total += 1;
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumbnailUrl),
        lang: this.lang,
      });
    });

    const unique = new Map<string, Manga>();
    for (const manga of mangas) if (!unique.has(manga.url)) unique.set(manga.url, manga);
    return { mangas: [...unique.values()], total };
  }

  private async getList(url: string): Promise<SearchResult> {
    const res = await this.get(url);
    const $ = this.$(res.data);
    const { mangas, total } = this.parseCards($);
    return {
      mangas,
      hasNextPage: total > 0 && $('a.next[href]').length > 0,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getList(this.listUrl(page, '/top'));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getList(this.listUrl(page));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return this.getLatest(page);

    const words = trimmed.split(/\s+/).filter(Boolean);
    const candidates = [trimmed, words.slice(0, 2).join(' '), words[0] ?? '']
      .map(value => value.trim())
      .filter(Boolean);
    const cached = this.searchCache.get(trimmed);
    const queries = cached
      ? [cached, ...candidates.filter(value => value !== cached)]
      : candidates;

    for (const value of queries) {
      const suffix = page > 1 ? `?page=${page}` : '';
      try {
        const result = await this.getList(`${this.baseUrl}/search/${encodeURIComponent(value)}${suffix}`);
        if (result.mangas.length > 0 || page > 1) {
          this.searchCache.set(trimmed, value);
          return result;
        }
      } catch {
        // Try the next shorter query.
      }
    }

    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const title =
      $('h1.h6').first().text().replace(/\s+/g, ' ').trim() ||
      $("meta[property='og:title']").attr('content')?.replace(/\s+-\s+\d+$/, '').trim() ||
      $('h1').first().text().replace(/\s+/g, ' ').trim();
    const thumbnailUrl =
      $("meta[property='og:image']").attr('content') ??
      $("a[data-fancybox] img").first().attr('src') ??
      '';
    const author = $("a[href^='/model/']").first().text().trim();

    const genres: string[] = [];
    $("a[href^='/cosplay/'], a[href^='/fandom/']").each((_, element) => {
      const genre = $(element).text().trim();
      if (genre) genres.push(genre);
    });

    const description = $('.accordion-body').first().text().replace(/\s+/g, ' ').trim();

    return {
      title: title || undefined,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: author || undefined,
      artist: author || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      description: description || undefined,
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
    $('a[data-fancybox]').each((_, element) => {
      const src = $(element).attr('href') ?? '';
      if (!src || seen.has(src)) return;
      seen.add(src);
      images.push(this.absUrl(src));
    });

    if (images.length === 0) {
      $('#photo-container img').each((_, element) => {
        const src = $(element).attr('data-src') ?? $(element).attr('src') ?? '';
        if (!src || seen.has(src)) return;
        seen.add(src);
        images.push(this.absUrl(src));
      });
    }

    return images.map((imageUrl, index) => ({ imageUrl, index }));
  }
}
