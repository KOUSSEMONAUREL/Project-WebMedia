import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ElanSchoolScraper extends BaseScraper {
  readonly name = 'Elan School';
  readonly baseUrl = 'https://elan.school';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
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
