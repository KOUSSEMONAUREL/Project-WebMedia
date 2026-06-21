import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class FmteamScraper extends BaseScraper {
  readonly name = 'FMTEAM';
  readonly baseUrl = 'https://fmteam.fr';
  readonly lang = 'fr';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/page/${page}/`);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.listupd article, .bs div.bsx, .uta .imgu, .page-item-detail').each((_, el) => {
      const a = $(el).find('a[href]').first();
      const href = a.attr('href') ?? '';
      const title = a.attr('title') ?? a.find('.tt').text().trim() ?? a.text().trim();
      const thumb = $(el).find('img').first().attr('data-src') ?? $(el).find('img').first().attr('src') ?? '';
      if (title && href) mangas.push({ title, url: href, thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('a.next.page-numbers, .pagination .next').length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get('/', { params: { s: query, page: String(page) } });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.listupd article, .bs div.bsx, .uta .imgu, .page-item-detail').each((_, el) => {
      const a = $(el).find('a[href]').first();
      const href = a.attr('href') ?? '';
      const title = a.attr('title') ?? a.find('.tt').text().trim() ?? a.text().trim();
      const thumb = $(el).find('img').first().attr('data-src') ?? $(el).find('img').first().attr('src') ?? '';
      if (title && href) mangas.push({ title, url: href, thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('a.next.page-numbers, .pagination .next').length > 0;
    return { mangas, hasNextPage };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul.chapter-list li, .clstyle li, .wp-manga-chapter, .chap-item').each((_, el) => {
      const a = $(el).find('a').first();
      const href = a.attr('href') ?? '';
      const name = a.text().trim() || $(el).find('.chapternum').text().trim();
      const dateText = $(el).find('.chapter-date, span.date, .updated').text().trim();
      chapters.push({ name, url: href, dateUpload: this._parseDate(dateText) });
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.reader-area img, .reading-content img, #readerarea img, .rdminimal img').each((i, el) => {
      const src = $(el).attr('data-src') ?? $(el).attr('src') ?? '';
      if (src) pages.push({ imageUrl: this.absUrl(src), index: i });
    });
    if (pages.length === 0) {
      const scripts = $('script').map((_, s) => $(s).html() ?? '').get();
      for (const script of scripts) {
        const jsonMatch = script.match(/var\s+chapterImages\s*=\s*(\[[\s\S]*?\])\s*;/);
        if (jsonMatch) {
          try {
            const images = JSON.parse(jsonMatch[1]);
            images.forEach((src: string, i: number) => {
              if (src) pages.push({ imageUrl: this.absUrl(src), index: i });
            });
          } catch (err) {
            console.error(`Failed to parse chapterImages JSON on ${this.name}: ${err instanceof Error ? err.message : err}`);
            continue;
          }
          break;
        }
        const tsReaderMatch = script.match(/images\s*:\s*(\[[\s\S]*?\])\s*,/);
        if (tsReaderMatch) {
          try {
            const images = JSON.parse(tsReaderMatch[1]);
            images.forEach((src: string, i: number) => {
              if (src) pages.push({ imageUrl: this.absUrl(src), index: i });
            });
          } catch (err) {
            console.error(`Failed to parse tsReader images JSON on ${this.name}: ${err instanceof Error ? err.message : err}`);
            continue;
          }
          break;
        }
      }
    }
    return pages;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.entry-title, .post-title h1, h1.entry-title').first().text().trim();
    const thumbnailUrl = $('.thumb img, .summary_image img').first().attr('data-src') ?? $('.thumb img, .summary_image img').first().attr('src') ?? '';
    const author = $('.autor a, .author-content a, .fmed-info a[href*="autor"]').first().text().trim();
    const description = $('.entry-content p, .summary__content p, .description p').first().text().trim();
    return { title, thumbnailUrl: this.absUrl(thumbnailUrl), author, description, lang: this.lang };
  }

  private _parseDate(dateStr: string): number | undefined {
    if (!dateStr) return undefined;
    const ts = Date.parse(dateStr.trim());
    return isNaN(ts) ? undefined : ts;
  }
}
