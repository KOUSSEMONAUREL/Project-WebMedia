import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class HolonometriaScraper extends BaseScraper {
  readonly name = 'HOLONOMETRIA';
  readonly baseUrl = 'https://holoearth.com';
  readonly lang = 'all';

  async getPopular(_page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/en/alt/holonometria/manga/`);
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('.manga__item').each((_, el) => {
      const $el = $(el);
      const url = $el.find('a').first().attr('abs:href') || '';
      const title = $el.find('.manga__title').text();
      const thumbnailUrl = $el.find('img').first().attr('abs:src') || '';
      mangas.push({ url: url.replace(this.baseUrl, ''), title, thumbnailUrl, lang: this.lang });
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, _page?: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/en/alt/holonometria/manga/#${query.trim()}`);
    const $ = this.$(response.data);
    const search = query.trim().toLowerCase();
    const mangas: Manga[] = [];
    $('.manga__item').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.manga__title').text();
      if (!title.toLowerCase().includes(search)) return;
      const url = $el.find('a').first().attr('abs:href') || '';
      const thumbnailUrl = $el.find('img').first().attr('abs:src') || '';
      mangas.push({ url: url.replace(this.baseUrl, ''), title, thumbnailUrl, lang: this.lang });
    });
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const info = $('.manga-detail__person').html()?.split('<br>') || [];
    const mangaKeywords = ['manga', 'gambar', '漫画'];
    const scriptKeywords = ['script', 'naskah', '脚本'];

    const author = info.find(line => mangaKeywords.some(k => line.toLowerCase().includes(k)))
      ?.split('：').pop()?.split(':').pop()?.trim()?.replace(/&amp;/g, '&');

    const artist = info.find(line => scriptKeywords.some(k => line.toLowerCase().includes(k)))
      ?.split('：').pop()?.split(':').pop()?.trim()?.replace(/&amp;/g, '&');

    return {
      title: $('.alt-nav__met-sub-link.is-current').text(),
      thumbnailUrl: $('.manga-detail__thumb img').attr('abs:src') || '',
      description: $('.manga-detail__caption').text() || undefined,
      author: author || undefined,
      artist: artist || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const chapters: Chapter[] = [];
    $('.manga-detail__list .manga-detail__list-item').each((_, el) => {
      const $el = $(el);
      const url = $el.find('a').first().attr('abs:href') || '';
      const name = $el.find('.manga-detail__list-title').text();
      const dateText = $el.find('.manga-detail__list-date').text();
      const dateUpload = dateText ? this.parseDate(dateText) : undefined;
      chapters.push({ url: url.replace(this.baseUrl, ''), name, dateUpload });
    });
    return chapters.reverse();
  }

  private parseDate(str: string): number | undefined {
    const d = new Date(str.replace(/\./g, '-'));
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const pages: Page[] = [];
    $('.manga-detail__swiper-wrapper img').each((i, el) => {
      pages.push({ index: i, imageUrl: $(el).attr('abs:src') || '' });
    });
    return pages.reverse();
  }
}
