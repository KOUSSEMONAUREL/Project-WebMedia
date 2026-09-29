import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class YaoiMangaOnlineScraper extends BaseScraper {
  readonly name = 'YaoiMangaOnline';
  readonly baseUrl = 'https://yaoimangaonline.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/page/${page}/`);
    return this.parseMangasPage(response.data);
  }

  private parseMangasPage(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.post:not(.sticky):not(.category-gay-movies):not(.category-yaoi-anime) > div > a').each((_, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      mangas.push({
        title: link.attr('title') || '',
        url: this.toPath(this.absUrl(href)),
        thumbnailUrl: link.find('img').first().attr('src') || '',
        lang: this.lang,
      });
    });
    const hasNextPage = $('.herald-pagination > .next').length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error('YaoiMangaOnline: getLatest() not supported');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/page/${page}/`);
    url.searchParams.set('s', query);
    const response = await this.get(url.toString());
    return this.parseMangasPage(response.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const rawTitle = $('h1.entry-title').first().text();
    const byIndex = rawTitle.lastIndexOf('by');
    const title = (byIndex >= 0 ? rawTitle.slice(0, byIndex) : rawTitle).trim();
    const thumbnailUrl = $('.herald-post-thumbnail img').first().attr('src') || '';
    const paragraphs = $('.entry-content > p').toArray();
    const description = paragraphs
      .filter(el => $(el).find('img').length === 0 && !$(el).text().includes('You need to login'))
      .map(el => $(el).text())
      .join('\n\n');
    const genre = $('.meta-tags > a').map((_, el) => $(el).text()).get().join(', ');
    const mangakaText = paragraphs.map(el => $(el).text()).find(text => text.includes('Mangaka:')) || '';
    const author = mangakaText.split('Mangaka:')[1]?.split('Language:')[0]?.trim() || undefined;
    return { title, thumbnailUrl, description, genre, author };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const mangaPath = this.toPath(this.absUrl(mangaUrl));
    const chapters: Chapter[] = [];
    $('.mpp-toc a').each((_, el) => {
      const link = $(el);
      const href = link.attr('href') || '';
      const name = link.clone().children().remove().end().text().trim();
      chapters.push({
        name,
        url: href ? this.toPath(this.absUrl(href)) : mangaPath,
      });
    });
    if (chapters.length === 0) {
      chapters.push({ name: 'Chapter', url: mangaPath });
    }
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('.entry-content img').each((idx, el) => {
      pages.push({ index: idx, imageUrl: $(el).attr('src') || '' });
    });
    return pages;
  }

  private toPath(url: string): string {
    if (url.startsWith(this.baseUrl)) return url.slice(this.baseUrl.length) || '/';
    return url;
  }
}
