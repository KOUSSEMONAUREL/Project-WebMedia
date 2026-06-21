import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class Manga18MeScraper extends BaseScraper {
  readonly name = 'Manga18.me';
  readonly baseUrl = 'https://manga18.me';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/manga/${page}?orderby=trending`);
    return this.parseListing(response.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('page', page.toString());
    const response = await this.get(url.toString());
    return this.parseListing(response.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.page-item-detail').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const url = a.attr('abs:href') || '';
      const img = $el.find('div.item-thumb.wleft img').first();
      const title = img.attr('alt') || '';
      const thumbnailUrl = $el.find('img').first().attr('abs:src') || '';
      mangas.push({ url: url.replace(this.baseUrl, ''), title, thumbnailUrl, lang: this.lang });
    });
    const hasNextPage = $('.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const info = $('div.post_content').first();
    const descParts: string[] = [];
    const mangaInfo = $('div.ss-manga').first().text();
    if (mangaInfo && mangaInfo !== 'N/A') descParts.push(mangaInfo);
    const altText = info.find('div.post-content_item.wleft:contains(Alternative) div.summary-content').text();
    if (altText && altText !== 'Updating') {
      descParts.push('Alternative Names:');
      altText.split(/[\/;]/).forEach(alt => descParts.push(`- ${alt.trim()}`));
    }
    const statusText = info.find('div.post-content_item.wleft:contains(Status) div.summary-content').text();
    const status = statusText === 'Ongoing' ? 1 : statusText === 'Completed' ? 1 : 2;
    const author = info.find('div.href-content.artist-content > a').first().text();
    const artist = info.find('div.href-content.artist-content > a').first().text();
    const genre = info.find('div.href-content.genres-content > a[href*=/manga-list/]').map((_, el) => $(el).text()).get().join(', ') || undefined;

    return {
      title: $('div.post-title.wleft > h1').text(),
      description: descParts.join('\n') || undefined,
      status,
      author: author && author !== 'Updating' ? author : undefined,
      artist: artist && artist !== 'Updating' ? artist : undefined,
      genre,
      thumbnailUrl: $('div.summary_image > img').first().attr('abs:src') || '',
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const chapters: Chapter[] = [];
    $('ul.row-content-chapter.wleft .a-h.wleft').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const url = link.attr('abs:href') || '';
      const name = link.text();
      const dateText = $el.find('span').first().text();
      const dateUpload = dateText ? this.parseDate(dateText) : undefined;
      chapters.push({ url: url.replace(this.baseUrl, ''), name, dateUpload });
    });
    return chapters;
  }

  private parseDate(str: string): number | undefined {
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('div.read-content.wleft img').each((i, el) => {
      pages.push({ index: i, imageUrl: $(el).attr('abs:src') || '' });
    });
    if (pages.length === 0) throw new Error('Unable to find script with image data');
    return pages;
  }
}
