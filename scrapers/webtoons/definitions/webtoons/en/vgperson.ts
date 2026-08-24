import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/vgperson`.
 * Single-page source: https://vgperson.com/other/mangaviewer.php
 * - Popular/search: links `.content a[href^=?m]` on the home page (search filters client-side).
 * - Details + chapters: `?m=<slug>` page (.title, .complete/.ongoing, .chaptertable tbody tr).
 * - Pages: every <img> of the chapter page.
 */
export class VgpersonScraper extends BaseScraper {
  readonly name = 'vgperson';
  readonly baseUrl = 'https://vgperson.com';
  readonly lang = 'en';

  private readonly homeUrl = `${this.baseUrl}/other/mangaviewer.php`;

  /** Known covers are hosted on imgur (upstream getCover). */
  private static readonly IMGUR_COVERS: Record<string, string> = {
    "The Festive Monster's Cheerful Failure": 'kEK10GL.png',
    'Azure and Claude': 'buXnlmh.jpg',
    'Three Days of Happiness': 'kL5dvnp.jpg',
  };

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const res = await this.get(this.homeUrl);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('.content a[href^=?m]').toArray().map(el => ({
      title: $(el).text().trim(),
      url: this.homeUrl + ($(el).attr('href') || ''),
      thumbnailUrl: this.getCover($(el).text()),
      lang: this.lang,
    })).filter(m => m.title && m.url);
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const { mangas } = await this.getPopular(page);
    const q = query.toLowerCase();
    return { mangas: mangas.filter(m => m.title.toLowerCase().includes(q)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.title').first().text().trim();
    const statusText = $('div.content .complete').first().text();
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.getCover(title),
      lang: this.lang,
      description: $('meta[name=description]').attr('content') || undefined,
      status: /complete/i.test(statusText) ? 0 : /ongoing|updating/i.test(statusText) ? 1 : undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters = $('.chaptertable tr').toArray().map(el => {
      const a = $(el).find('td > a').first();
      const name = a.text().trim();
      let url = a.attr('href') || '';
      if (url && !url.startsWith('http')) url = this.homeUrl + url;
      const chapterNumber = this.specialChapterNumber(url)
        ?? (name.match(/chapter\s*([\d.]+)/i)?.[1] ? parseFloat(name.match(/chapter\s*([\d.]+)/i)![1]) : undefined);
      return { name, url, chapterNumber, scanlator: 'vgperson' };
    }).filter(ch => ch.name && ch.url);
    return chapters.reverse();
  }

  /** Upstream hardcodes chapter numbers for Three Days of Happiness (?c= or 16.5 + ?b=/10). */
  private specialChapterNumber(url: string): number | undefined {
    try {
      const parsed = new URL(url);
      const c = parsed.searchParams.get('c');
      if (c) return parseFloat(c);
      const b = parsed.searchParams.get('b');
      if (b) return 16.5 + parseFloat(b) / 10;
    } catch {
      /* relative query-only URLs have no base yet */
    }
    return undefined;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('img').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    })).filter(p => p.imageUrl);
  }

  private getCover(title: string): string {
    const key = Object.keys(VgpersonScraper.IMGUR_COVERS).find(k => title === k);
    return key ? `https://i.imgur.com/${VgpersonScraper.IMGUR_COVERS[key]}` : '';
  }
}
