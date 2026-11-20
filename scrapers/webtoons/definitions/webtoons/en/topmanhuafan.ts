import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const PAGE_SIZE = 20;

export class TopmanhuafanScraper extends BaseScraper {
  readonly name = 'Top Manhua Fan';
  readonly baseUrl = 'https://www.topmanhua.fan';
  readonly lang = 'en';

  private async fetchPopularManga(page: number): Promise<Manga[]> {
    const offset = (page - 1) * PAGE_SIZE;
    const url = `${this.baseUrl}/wp-admin/admin-ajax.php?action=wp_manga_popular&offset=${offset}&limit=${PAGE_SIZE}`;
    const res = await this.get(url);
    const data = res.data;
    if (!data || data.length === 0) return [];
    return data.map((item: any) => ({
      title: item.title || 'Unknown',
      url: item.permalink || `${this.baseUrl}/manhua/${item.slug}`,
      thumbnailUrl: item.thumbnail_url || '',
      lang: this.lang,
    }));
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const mangas = await this.fetchPopularManga(page);
    return { mangas, hasNextPage: mangas.length === PAGE_SIZE };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/wp-admin/admin-ajax.php?action=wp_manga_search&search=${encodeURIComponent(
      query,
    )}&page=${page}`;
    const res = await this.get(url);
    const data = res.data as Array<{ title: string; slug: string }> || [];
    const mangas = data.map((item) => ({
      title: item.title || 'Unknown',
      url: `${this.baseUrl}/manhua/${item.slug}`,
      thumbnailUrl: '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: data.length > 0 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const url = new URL(mangaUrl.startsWith('http') ? mangaUrl : `${this.baseUrl}${mangaUrl}`);
    const slug = url.pathname.replace('/manhua/', '').replace('/', '') || 'unknown';
    const res = await this.get(`/manhua/${slug}`);
    const $ = this.$(res.data as string);
    const title = $('h1.entry-title').first().text().trim() || $('title').first().text().split('|')[0].trim();
    const description = $('#entry-content p').first().text().trim() || undefined;
    const thumbnail = $('img.first-img').first().attr('src') || $('meta[property="og:image"]').attr('content') || '';
    return {
      url: mangaUrl,
      title,
      thumbnailUrl: thumbnail ? this._absUrl(thumbnail) : '',
      author: undefined,
      description,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = new URL(mangaUrl.startsWith('http') ? mangaUrl : `${this.baseUrl}${mangaUrl}`);
    const slug = url.pathname.replace('/manhua/', '').replace('/', '') || 'unknown';
    const res = await this.get(`/manhua/${slug}`);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];
    $('.chapter-list a.chapter-item').each((_: any, el: any) => {
      const $el = $(el);
      const title = $el.text().trim();
      const href = $el.attr('href');
      if (!href) return;
      chapters.push({
        name: title,
        url: href,
        chapterNumber: undefined,
        dateUpload: undefined,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const pages: Page[] = [];
    $('#page-nav img').each((i: number, el: any) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src) {
        pages.push({ index: i, imageUrl: this._absUrl(src) });
      }
    });
    return pages;
  }

  private _absUrl(src: string): string {
    if (!src) return '';
    if (src.startsWith('http')) return src;
    const u = new URL(src, this.baseUrl);
    return u.toString();
  }
}