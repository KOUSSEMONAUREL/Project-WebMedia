import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface ReaderImage {
  page: number;
  url: string;
  alt?: string;
}

interface ReaderImagesResponse {
  ok: boolean;
  images: ReaderImage[];
}

const DATE_FORMAT = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class KhoManhwaScraper extends BaseScraper {
  readonly name = 'KhoManhwa';
  readonly baseUrl = 'https://khomanhwa.com';
  readonly lang = 'vi';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.parseMangaList((await this.get(`/popular?page=${page}`)).data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.parseMangaList((await this.get(`/latest?page=${page}`)).data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('q', query);
    return this.parseMangaList((await this.get(`/search?${params.toString()}`)).data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('.series-main h1').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: $('.cover-card img').first().attr('src') || '',
      description: $('.summary-inline p').first().text().trim() || undefined,
      author: $('a[href*="author="] span').first().text().trim() || undefined,
      artist: $('a[href*="artist="] span').first().text().trim() || undefined,
      status: this.parseStatus($('.status-badge').first().text().trim()),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.chapter-row').each((_, el) => {
      const row = $(el);
      const link = row.find('a.chapter-main').first();
      const href = link.attr('href');
      if (!href) return;
      const number = row.attr('data-number');
      const dateUpload = this.parseChapterDate(row.find('.chapter-age').first().text().trim());
      chapters.push({
        name: row.find('.chapter-name strong').first().text().trim(),
        url: this.absUrl(href),
        chapterNumber: number ? parseFloat(number) : undefined,
        dateUpload,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const boxImages = $('#chapter_boxImages');
    const token = boxImages.attr('data-token');
    if (token) {
      const apiUrl = this.absUrl(boxImages.attr('data-endpoint') || '/reader_images.php');
      const apiParams = new URLSearchParams({
        manga: boxImages.attr('data-manga') || '',
        chapter: boxImages.attr('data-chapter') || '',
        token,
      });
      const apiRes = await this.get(`${apiUrl}?${apiParams.toString()}`);
      const apiRaw = apiRes.data;
      const data = (typeof apiRaw === 'string' ? JSON.parse(apiRaw) : apiRaw) as ReaderImagesResponse;
      if (data.ok) {
        return data.images
          .filter(img => img.url)
          .map(img => ({ index: img.page - 1, imageUrl: img.url }));
      }
      return [];
    }
    const pages: Page[] = [];
    $('#chapter_boxImages img.chapter-page').each((index, el) => {
      const src = $(el).attr('src') || '';
      if (src) pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('a.series-card').each((_, el) => {
      const card = $(el);
      const href = card.attr('href');
      if (!href) return;
      const title = card.find('strong').first().text().trim();
      if (!title) return;
      const img = card.find('img').first();
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: img.attr('src') || img.attr('data-src') || '',
        lang: this.lang,
      });
    });
    const hasNextPage = $('nav.pagination a').toArray().some(el => $(el).text() === 'Next');
    return { mangas, hasNextPage };
  }

  private parseStatus(text: string): MangaStatus {
    switch (text.trim().toLowerCase()) {
      case 'ongoing':
        return 1;
      case 'completed':
        return 2;
      case 'hiatus':
        return 3;
      default:
        return 0;
    }
  }

  private parseChapterDate(text: string): number | undefined {
    const match = DATE_FORMAT.exec(text.trim());
    if (!match) return undefined;
    const month = MONTHS.indexOf(match[1]);
    if (month === -1) return undefined;
    return Date.UTC(parseInt(match[3], 10), month, parseInt(match[2], 10));
  }
}
