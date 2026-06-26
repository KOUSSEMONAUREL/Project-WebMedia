import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MangahereScraper extends BaseScraper {
  readonly name = 'Mangahere';
  readonly baseUrl = 'https://www.mangahere.cc';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/directory/${page}.htm`);
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
    const res = await this.get(`${this.baseUrl}/directory/${page}.htm?latest`);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    return this.getPopular(page);
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
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
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapterEls = $("a");
    return chapterEls.toArray().map((el, i) => ({
      name: $(el).text().trim(),
      url: this.absUrl($(el).attr("href") || ""),
      chapterNumber: i + 1,
    })).filter(ch => ch.url && ch.name);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $("img").toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr("src") || ""),
    }));
  }
}
