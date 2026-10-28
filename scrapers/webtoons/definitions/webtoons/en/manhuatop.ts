import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface DiscoveryItem {
  title: string;
  path: string;
  thumbnail?: string;
}

interface DiscoveryResponse {
  items?: DiscoveryItem[];
  hasMore?: boolean;
}

const DISCOVERY_URL = 'https://manhuatop.org/api/discovery';
const CHAPTER_PAGE_SIZE = 50;

export class ManhuatopScraper extends BaseScraper {
  readonly name = 'Manhua Top';
  readonly baseUrl = 'https://manhuatop.org';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.discover(this.seriesPath(page, 'trending-week'));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.discover(this.seriesPath(page, 'latest_update'));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const base = `/search/${encodeURIComponent(query)}/`;
    return this.discover(page > 1 ? `${base}?page=${page}` : base);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const title =
      $('#manga-title').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      '';
    const thumbnailUrl = this.absUrl(
      $('.detail-cover img').first().attr('src') ||
        $('meta[property="og:image"]').attr('content') ||
        '',
    );
    const descriptionRoot = $('.rich-content.synopsis').first().clone();
    descriptionRoot.find('h2, h3, .text-button').remove();
    const description = descriptionRoot.text().replace(/\s+/g, ' ').trim() || undefined;
    const author = this.metadataValue($, 'Author');
    const artist = this.metadataValue($, 'Artist');
    const genre = $('.genre-chips a')
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean)
      .join(', ') || undefined;
    const status = this.parseStatus($('.status-badge').first().text());

    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      description,
      author,
      artist,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const cleanUrl = mangaUrl.replace(/[?#].*$/, '').replace(/\/?$/, '/');
    const firstHtml = await this.fetchChapterPage(cleanUrl, 1);
    const chapters = this.parseChapters(firstHtml);
    const total = this.parseChapterTotal(firstHtml);
    const pageCount = total > 0
      ? Math.ceil(total / CHAPTER_PAGE_SIZE)
      : Math.ceil(chapters.length / CHAPTER_PAGE_SIZE);

    const remainingPages = Array.from(
      { length: Math.max(0, pageCount - 1) },
      (_, index) => index + 2,
    );
    const batchSize = 5;
    for (let i = 0; i < remainingPages.length; i += batchSize) {
      const batch = remainingPages.slice(i, i + batchSize);
      const htmls = await Promise.all(batch.map((page) => this.fetchChapterPage(cleanUrl, page)));
      for (const html of htmls) chapters.push(...this.parseChapters(html));
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    return $('figure.reader-image img')
      .toArray()
      .map((el, index) => ({
        index,
        imageUrl: this.absUrl($(el).attr('src') || ''),
      }))
      .filter((page) => Boolean(page.imageUrl));
  }

  private seriesPath(page: number, sort: string): string {
    return page > 1 ? `/series/page/${page}/?sort=${sort}` : `/series/?sort=${sort}`;
  }

  private async discover(path: string): Promise<SearchResult> {
    const res = await this.get(DISCOVERY_URL, { params: { path } });
    const body = this.parseJson<DiscoveryResponse>(res.data);
    return {
      mangas: (body.items ?? []).map((item) => ({
        title: item.title,
        url: this.absUrl(item.path),
        thumbnailUrl: item.thumbnail || '',
        lang: this.lang,
      })),
      hasNextPage: Boolean(body.hasMore),
    };
  }

  private parseJson<T>(data: unknown): T {
    return (typeof data === 'string' ? JSON.parse(data) : data) as T;
  }

  private metadataValue($: CheerioAPI, label: string): string | undefined {
    const cell = $('.metadata-list dt')
      .filter((_, el) => $(el).text().trim().toLowerCase() === label.toLowerCase())
      .first()
      .next('dd');
    const links = cell.find('a')
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean);
    const value = links.length > 0 ? links.join(', ') : cell.text().trim();
    return value || undefined;
  }

  private parseStatus(text: string): MangaStatus {
    const status = text.toLowerCase();
    if (status.includes('ongoing') || status.includes('on-going') || status.includes('updating')) return 1;
    if (status.includes('completed') || status.includes('complete')) return 0;
    if (status.includes('cancel') || status.includes('dropped')) return 2;
    return 3;
  }

  private async fetchChapterPage(mangaUrl: string, page: number): Promise<string> {
    const url = `${mangaUrl}?tab=chapters&chapter_page=${page}&chapter_order=desc`;
    const res = await this.get(url);
    return res.data as string;
  }

  private parseChapters(html: string): Chapter[] {
    const $ = this.$(html);
    return $('.chapter-item a')
      .toArray()
      .map((el) => {
        const $a = $(el);
        const label =
          $a.find('strong').first().text().trim() ||
          $a.clone().find('time').remove().end().text().replace(/\s+/g, ' ').trim();
        const href = $a.attr('href') || '';
        const dateText = $a.find('time').attr('datetime') || '';
        const date = dateText ? Date.parse(dateText) : Number.NaN;
        return {
          name: label,
          url: this.absUrl(href),
          chapterNumber: this.parseChapterNumber(label),
          dateUpload: Number.isFinite(date) ? date : undefined,
        };
      })
      .filter((chapter) => Boolean(chapter.url));
  }

  private parseChapterTotal(html: string): number {
    const $ = this.$(html);
    const match = $('.loaded-count').first().text().match(/of\s+([\d,]+)/i);
    return match ? Number.parseInt(match[1].replace(/,/g, ''), 10) : 0;
  }

  private parseChapterNumber(label: string): number | undefined {
    const match = label.match(/chapter\s*([\d.]+)/i) ?? label.match(/([\d.]+)/);
    if (!match) return undefined;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : undefined;
  }
}

export default ManhuatopScraper;
