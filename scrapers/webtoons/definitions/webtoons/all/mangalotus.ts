import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MangaLotusScraper extends BaseScraper {
  override readonly name = 'Manga Lotus';
  override readonly baseUrl = 'https://mangalotus.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const path = page > 1 ? `/tag/english/page/${page}/` : '/tag/english/';
    const res = await this.get(path);
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/page/${page}/`);
    url.searchParams.set('s', query);
    url.searchParams.set('tag', 'english');
    const res = await this.get(url.toString());
    return this.parseListing(res.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.post:not(.sticky):not(.category-yaoi-anime-online) > div > a').each((_, el) => {
      const link = $(el);
      const href = link.attr('href');
      const title = link.attr('title');
      if (!href || !title) return;
      const thumb = link.find('img').first().attr('src') || '';
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb).replace(/-\d+x\d+(?=\.\w+$)/, ''),
        lang: this.lang,
      });
    });
    const hasNextPage = $('.herald-pagination > .next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1.entry-title').first().text().trim();
    const thumbnailUrl = $('meta[property=og:image]').attr('content') || '';
    const description = $('.entry-content > p')
      .filter((_, el) => $(el).find('img').length === 0)
      .map((_, el) => $(el).text())
      .get()
      .join('\n\n');
    const genre = [
      ...$('.meta-category a').toArray(),
      ...$('.meta-tags > a').toArray(),
    ]
      .map(el => $(el).text().trim())
      .filter(Boolean)
      .join(', ');
    const status = $('article.herald-single.tag-completed-yaoi-manga').length > 0 ? 0 : 3;
    return { title, url: mangaUrl, thumbnailUrl, description, genre, status, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.mpp-toc a').each((_, el) => {
      const link = $(el);
      const href = link.attr('href');
      const name = link.clone().children().remove().end().text().trim();
      chapters.push({ name, url: this.absUrl(href || mangaUrl) });
    });
    if (chapters.length === 0) {
      chapters.push({ name: 'Chapter', url: mangaUrl });
    }
    const result = chapters.reverse();
    const published = $('meta[property=article:published_time]').attr('content');
    if (published) {
      const time = Date.parse(published);
      if (!Number.isNaN(time)) result[0].dateUpload = time;
    }
    return result;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.entry-content img').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      pages.push({
        index: pages.length,
        imageUrl: this.absUrl(src).replace(/^http:\/\//, 'https://'),
      });
    });
    return pages;
  }
}
