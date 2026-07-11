import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MangagoScraper extends BaseScraper {
  readonly name = 'Mangago';
  readonly baseUrl = 'https://www.mangago.net';
  readonly lang = 'en';

  // Chapter reader mirror; "/chapter/..." paths 404 on the main domain.
  // The main domain randomly alternates between two chapter URL formats
  // with unrelated ids, while the mirror consistently serves
  // "/chapter/<mangaId>/<chapterId>/".
  private readonly readerDomain = 'www.mangago.zone';

  // Base domain (without www) used for URL matching
  private readonly domain = 'mangago.me';

  private mangaPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private readerUrl(path: string): string {
    return `https://${this.readerDomain}${path}`;
  }

  private chapterUrl(chapterUrl: string): string {
    if (chapterUrl.startsWith('http://') || chapterUrl.startsWith('https://')) {
      return chapterUrl;
    }
    if (chapterUrl.startsWith('/chapter/')) {
      return `https://${this.readerDomain}${chapterUrl}`;
    }
    return this.absUrl(chapterUrl);
  }

  private async fetchWithFallback(primaryUrl: string, fallbackUrl: string): Promise<string> {
    try {
      const res = await this.get(primaryUrl);
      return res.data as string;
    } catch {
      const res = await this.get(fallbackUrl);
      return res.data as string;
    }
  }

  private selectChapterRows($: any) {
    return $("table#chapter_table > tbody > tr, table.uk-table > tbody > tr").toArray();
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/genre/all/${page}/?f=1&o=1&sortby=view&e=`);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $("a").each((_, el) => {
      const $el = $(el);
      mangas.push({
        title: $el.text().trim(),
        url: this.absUrl($el.attr("href") || ""),
        thumbnailUrl: this.absUrl($el.find("img").attr("src") || ""),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const path = this.mangaPath(mangaUrl);
    const html = await this.fetchWithFallback(this.readerUrl(path), mangaUrl);
    const $ = this.$(html);
    return {
      title: $("h1").text() || $("title").text() || "",
      url: mangaUrl,
      thumbnailUrl: this.absUrl($("img").first()?.attr("src") || ""),
      description: $("meta[name=description]").attr("content") || $(".description, .summary, .entry-content").first()?.text()?.trim() || undefined,
      author: $(".author, .artist").text() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const path = this.mangaPath(mangaUrl);
    const html = await this.fetchWithFallback(this.readerUrl(path), mangaUrl);
    const $ = this.$(html);
    return this.selectChapterRows($).map((row: any) => {
      const link = $(row).find("a.chico");
      const rawUrl = link.attr("href") || "";
      let url: string;
      try {
        const httpUrl = new URL(rawUrl, this.baseUrl);
        if (httpUrl.pathname.startsWith('/chapter/')) {
          // Reader links rotate between mirror hosts but keep a
          // stable path. Store only the path so rotated links don't
          // register as new chapters (resetting read state).
          url = httpUrl.pathname;
        } else if (httpUrl.host.endsWith(this.domain)) {
          url = httpUrl.pathname + httpUrl.search;
        } else {
          url = httpUrl.href;
        }
      } catch {
        url = this.absUrl(rawUrl);
      }
      return {
        name: link.text().trim(),
        url,
        chapterNumber: -1,
      };
    }).filter((ch: any) => ch.url && ch.name);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = this.chapterUrl(chapterUrl);
    const res = await this.get(url);
    const $ = this.$(res.data);
    return $("img").toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr("src") || ""),
    }));
  }
}
