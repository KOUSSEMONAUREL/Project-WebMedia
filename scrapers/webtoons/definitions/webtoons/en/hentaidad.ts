import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HentaiDadScraper extends BaseScraper {
  override readonly name = 'HentaiDad';
  override readonly baseUrl = 'https://hentaidad.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl(page, 'trending'));
    return this.parseListing(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl(page, 'images'));
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.listUrl(page, 'search'));
    if (query.trim()) url.searchParams.set('q', query.trim());
    const res = await this.get(url.toString());
    return this.parseListing(res.data);
  }

  private listUrl(page: number, ...segments: string[]): string {
    const path = segments.map(segment => encodeURIComponent(segment)).join('/');
    const suffix = page > 1 ? `/${page}` : '';
    return `${this.baseUrl}/${path}${suffix}`;
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.archive-grid article.archive-card').each((_, el) => {
      const card = $(el);
      if (card.find('.archive-card-type').text().trim() !== 'Gallery') return;
      const link = card.find('a.archive-card-link').first();
      const href = link.attr('href');
      const title = link.find('.archive-card-title').text().trim();
      if (!href || !title) return;
      const thumb = link.find('img').first().attr('src') || '';
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb),
        lang: this.lang,
      });
    });
    const hasNextPage = $('a.pagination-direction[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('header.post-header h1').first().text().trim();
    const thumbnailUrl =
      $('#premium-gallery a.post-gallery-item img').first().attr('src') ||
      $('meta[property=og:image]').attr('content') ||
      '';
    const genre = $('.post-tags a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join(', ');
    const description = $('.post-description > div').first().text().trim();
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      genre: genre || undefined,
      description: description || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const dateText = $('.post-meta time').attr('datetime') || '';
    const time = Date.parse(dateText);
    return [{
      name: 'Gallery',
      url: mangaUrl,
      dateUpload: Number.isNaN(time) ? undefined : time,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('#premium-gallery a.post-gallery-item').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      pages.push({ index: pages.length, imageUrl: this.absUrl(href) });
    });
    return pages;
  }
}
