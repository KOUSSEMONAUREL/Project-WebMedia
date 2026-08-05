import { BaseScraper } from '../../../engine/base';
import type { CheerioAPI } from 'cheerio';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface SearchDto {
  title: string;
  url: string;
  post_type?: string | null;
  thumb?: string | null;
}

const THUMBNAIL_SIZE_REGEX = /-(\d+x\d+)(\.[a-zA-Z0-9]+(?:\?.*)?)$/;

export class SangChanhTeamScraper extends BaseScraper {
  readonly name = 'SangChanhTeam';
  readonly baseUrl = 'https://sangchanhteam.com';
  readonly lang = 'vi';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.parseMangaPage((await this.get(this.filterUrl(page, 'views'))).data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.parseMangaPage((await this.get(this.filterUrl(page, 'updated'))).data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim()) {
      if (page > 1) return { mangas: [], hasNextPage: false };
      const res = await this.get(`/wp-json/initlise/v1/search?term=${encodeURIComponent(query.trim())}`);
      const raw = res.data;
      const dtos = (typeof raw === 'string' ? JSON.parse(raw) : raw) as SearchDto[];
      const mangas: Manga[] = [];
      for (const dto of dtos) {
        if (dto.post_type && dto.post_type !== 'manga') continue;
        if (!dto.url) continue;
        mangas.push({
          title: this.$(`<div>${dto.title}</div>`).text().trim(),
          url: dto.url,
          thumbnailUrl: dto.thumb ? this.fullImageUrl(this.absUrl(dto.thumb)) : '',
          lang: this.lang,
        });
      }
      return { mangas: this.distinctByUrl(mangas), hasNextPage: false };
    }
    return this.parseMangaPage((await this.get(this.filterUrl(page, 'updated'))).data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const thumbImg = $("img[alt^='Ảnh bìa của']").first();
    const thumbnailUrl = this.extractImageUrl(thumbImg) || $('meta[property="og:image"]').attr('content') || '';
    const genre =
      $('.manga-block a[href*="/the-loai/"]').toArray().map(el => $(el).text().trim()).join(', ') || undefined;
    return {
      title: $('main h1').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl,
      genre,
      status: this.parseStatus($('#manga-status').first().text().trim()),
      description: $('#manga-description').first().text().trim() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const firstRes = await this.get(mangaUrl);
    const firstDoc = firstRes.data;
    const base = mangaUrl.replace(/\/+$/, '');
    const $ = this.$(firstDoc);
    const lastPage = $('.uk-pagination a[href*="/chap/page/"]').toArray().reduce((max, el) => {
      const match = /\/chap\/page\/(\d+)/.exec($(el).attr('href') || '');
      const n = match ? parseInt(match[1], 10) : NaN;
      return Number.isInteger(n) ? Math.max(max, n) : max;
    }, 1);

    const docs = [firstDoc];
    for (let p = 2; p <= lastPage; p++) {
      const pageRes = await this.get(`${base}/chap/page/${p}/`);
      docs.push(pageRes.data);
    }

    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const doc of docs) {
      for (const chapter of this.chaptersFromDocument(doc)) {
        if (!seen.has(chapter.url)) {
          seen.add(chapter.url);
          chapters.push(chapter);
        }
      }
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const urls: string[] = [];
    $('#chapter-content img').each((_, el) => {
      const img = $(el);
      const src = img.attr('data-original-src') || img.attr('src') || '';
      if (src && !src.startsWith('data:') && src.includes('init-manga/')) {
        urls.push(this.absUrl(src));
      }
    });
    const pages: Page[] = [];
    for (const [index, url] of [...new Set(urls)].entries()) {
      pages.push({ index, imageUrl: url });
    }
    return pages;
  }

  private filterUrl(page: number, sort: string): string {
    const segments = ['bo-loc-nang-cao'];
    if (page > 1) {
      segments.push('page', String(page));
    }
    const params = new URLSearchParams({
      type: '',
      status: '',
      age_rating: '',
      team: '',
      rating_min: '0',
      rating_max: '6',
      sort,
    });
    return `${this.baseUrl}/${segments.join('/')}/?${params.toString()}`;
  }

  private parseMangaPage(html: string): SearchResult {
    const $ = this.$(html);
    const mangas = $('main .uk-grid-small:has(> .uk-width-1-3):has(h2 a[href*="/truyen/"])')
      .toArray()
      .map(el => this.mangaFromElement($(el)))
      .filter((m): m is Manga => m !== null);
    const hasNextPage = $('.uk-pagination li:not(.uk-disabled) > a[aria-label="Trang sau"]').length > 0;
    return { mangas: this.distinctByUrl(mangas), hasNextPage };
  }

  private mangaFromElement(el: ReturnType<CheerioAPI>): Manga | null {
    const link = el.find('h2 a[href*="/truyen/"], h3 a[href*="/truyen/"], a.uk-link-toggle[href*="/truyen/"]').first();
    const href = link.attr('href');
    if (!href) return null;
    const title = link.text().trim();
    const thumbnailUrl = this.extractImageUrl(el.find('img').first()) || '';
    return { title, url: this.absUrl(href), thumbnailUrl, lang: this.lang };
  }

  private chaptersFromDocument(html: string): Chapter[] {
    const $ = this.$(html);
    const chapters: Chapter[] = [];
    $('#chapter-list a.uk-link-toggle[href*="/chap-"]').each((_, el) => {
      const a = $(el);
      const href = a.attr('href');
      if (!href) return;
      const url = this.absUrl(href);
      const chapterSlug = url.replace(/\/+$/, '').split('/').pop() || '';
      const h3 = a.find('h3').first().text().trim();
      let name = h3 ? this.substringAfterLast(h3, '–').trim().replace('Chap', 'Chương') : '';
      if (!name) {
        name = chapterSlug.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
      }
      const numMatch = /^chap-(\d+(?:\.\d+)?)$/.exec(chapterSlug);
      const chapterNumber = numMatch ? parseFloat(numMatch[1]) : -1;
      const time = a.find('time').first();
      const datetime = time.attr('datetime');
      let dateUpload: number | undefined;
      if (datetime) {
        const parsed = Date.parse(datetime);
        if (!Number.isNaN(parsed)) dateUpload = parsed;
      }
      if (dateUpload === undefined) {
        const relative = this.parseRelativeDate(time.text());
        dateUpload = relative > 0 ? relative : undefined;
      }
      chapters.push({ name, url, chapterNumber, dateUpload });
    });
    return chapters;
  }

  private parseStatus(value: string): MangaStatus {
    const status = value.toLowerCase();
    if (status.includes('đang tiến hành') || status.includes('đã theo kịp')) return 1;
    if (status.includes('trọn bộ') || status.includes('hoàn thành')) return 2;
    if (status.includes('kết thúc mùa') || status.includes('tạm ngưng') || status.includes('bị hủy')) return 3;
    return 0;
  }

  private parseRelativeDate(value: string): number {
    const text = value.toLowerCase().trim();
    if (text === 'mới' || text.includes('vừa xong')) return Date.now();
    const amountMatch = /(\d+)/.exec(text);
    if (!amountMatch) return 0;
    const amount = parseInt(amountMatch[1], 10);
    let ms: number;
    if (text.includes('giây')) ms = amount * 1000;
    else if (text.includes('phút')) ms = amount * 60_000;
    else if (text.includes('giờ')) ms = amount * 3_600_000;
    else if (text.includes('ngày')) ms = amount * 86_400_000;
    else if (text.includes('tuần')) ms = amount * 7 * 86_400_000;
    else if (text.includes('tháng')) ms = amount * 30 * 86_400_000;
    else if (text.includes('năm')) ms = amount * 365 * 86_400_000;
    else return 0;
    return Date.now() - ms;
  }

  private extractImageUrl(img: ReturnType<CheerioAPI>): string {
    const src =
      img.attr('data-original-src') ||
      img.attr('data-src') ||
      img.attr('data-lazy-src') ||
      img.attr('src') ||
      '';
    return src ? this.absUrl(src) : '';
  }

  private fullImageUrl(url: string): string {
    return url.replace(THUMBNAIL_SIZE_REGEX, '$2');
  }

  private substringAfterLast(text: string, delimiter: string): string {
    const index = text.lastIndexOf(delimiter);
    return index === -1 ? text : text.slice(index + delimiter.length);
  }

  private distinctByUrl(mangas: Manga[]): Manga[] {
    const seen = new Set<string>();
    const result: Manga[] = [];
    for (const manga of mangas) {
      if (!seen.has(manga.url)) {
        seen.add(manga.url);
        result.push(manga);
      }
    }
    return result;
  }
}
