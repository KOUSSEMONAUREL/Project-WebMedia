import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface MangaDto {
  title: string;
  thumb?: string | null;
  cover_image_url?: string | null;
  normalized_title: string;
}

interface SearchResponse {
  data: MangaDto[];
  total: number;
}

const PAGE_SIZE = 18;

export class KuraMangaScraper extends BaseScraper {
  readonly name = 'KuraManga';
  readonly baseUrl = 'https://kuramanga.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    void page;
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data as string);
    const mangas: Manga[] = $('section:has(h2:contains(Popular)) a.sp-card')
      .toArray()
      .map((el) => {
        const $el = $(el);
        const title = $el.find('.sp-cap h3').text().trim();
        if (!title) return null;
        const href = $el.attr('href') ?? '';
        const thumb = $el.find('img').attr('src') ?? $el.find('img').attr('abs:src') ?? '';
        return {
          title,
          url: this.absUrl('/' + href.replace(/^\//, '')),
          thumbnailUrl: this.absUrl(thumb),
          lang: this.lang,
        } as Manga;
      })
      .filter((m): m is Manga => m !== null);
    return { mangas, hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const pageUrl = page > 1 ? `${this.baseUrl}/?page=${page}` : `${this.baseUrl}/`;
    const res = await this.get(pageUrl);
    const $ = this.$(res.data as string);
    const mangas: Manga[] = $('.update-list .update-row')
      .toArray()
      .map((el) => {
        const $el = $(el);
        const link = $el.find('a.update-series-link').first();
        if (!link.length) return null;
        const title = link.text().trim();
        const href = link.attr('href') ?? '';
        const thumb = $el.find('img').attr('src') ?? '';
        return {
          title,
          url: this.absUrl('/' + href.replace(/^\//, '')),
          thumbnailUrl: this.absUrl(thumb),
          lang: this.lang,
        } as Manga;
      })
      .filter((m): m is Manga => m !== null);

    const distinct = mangas.filter((m, i, arr) => arr.findIndex((x) => x.url === m.url) === i);
    const hasNextPage = $('a[data-lu-next]:not(.is-disabled)').length > 0;
    return { mangas: distinct, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('ajax', '1');
    url.searchParams.set('page', String(page));
    if (query.trim()) url.searchParams.set('name', query);

    const searchHeaders = { 'X-Requested-With': 'XMLHttpRequest' };
    const res = await this.get(url.toString(), { headers: searchHeaders });
    const data = res.data as SearchResponse;
    const mangas: Manga[] = (data.data ?? []).map((dto) => ({
      title: dto.title,
      url: this.absUrl(`/${dto.normalized_title}`),
      thumbnailUrl: this.absUrl(dto.thumb ?? dto.cover_image_url ?? ''),
      lang: this.lang,
    }));
    const hasNextPage = data.data.length === PAGE_SIZE && (data.total === 0 || page * PAGE_SIZE < data.total);
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const title = $('h1.manga-title').first().text().trim();
    const description = $('.summary-inner').text().trim() || $('.mp-synopsis').text().trim() || undefined;
    const storyAndArt =
      $('.mp-cred:has(.mp-cred-k:contains(Story & Art)) .mp-cred-v').text().trim() ||
      $('.mp-cred:has(.mp-cred-k:contains(Author & Artist)) .mp-cred-v').text().trim() ||
      undefined;
    const author =
      $('.mp-cred:has(.mp-cred-k:contains(Author)) .mp-cred-v').text().trim() ||
      $('.mp-cred:has(.mp-cred-k:contains(Story)) .mp-cred-v').text().trim() ||
      storyAndArt ||
      $('.meta-grid div:contains(Author:)').text().replace('Author:', '').trim() ||
      undefined;
    const artist =
      $('.mp-cred:has(.mp-cred-k:contains(Artist)) .mp-cred-v').text().trim() ||
      $('.mp-cred:has(.mp-cred-k:contains(Art)) .mp-cred-v').text().trim() ||
      storyAndArt ||
      $('.meta-grid div:contains(Artist:)').text().replace('Artist:', '').trim() ||
      undefined;
    const genre = $('.genre-list a.genre-chip')
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean)
      .join(', ');
    const statusRaw =
      $('.mp-status').text().trim() || $('.meta-grid div:contains(Status:)').text().replace('Status:', '').trim();
    const status = this.parseStatus(statusRaw || undefined);
    const thumbnailUrl = this.absUrl($('meta[property="og:image"]').attr('content') ?? '');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      description,
      author: author || undefined,
      artist: artist || undefined,
      genre: genre || undefined,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = $('.chapter-list .chapter-item')
      .toArray()
      .map((el) => {
        const $el = $(el);
        const link = $el.find('a').first();
        if (!link.length) return null;
        const name = link.text().trim();
        const href = link.attr('href') ?? '';
        const dateStr = $el.find('time').text().trim();
        const dateUpload = this.parseDate(dateStr);
        return {
          name,
          url: this.absUrl('/' + href.replace(/^\//, '')),
          dateUpload,
        } as Chapter;
      })
      .filter((c): c is Chapter => c !== null);
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    const pages: Page[] = $('#chapterImages img')
      .toArray()
      .map((el, index) => {
        const $img = $(el);
        const src = $img.attr('data-src') || $img.attr('abs:data-src') || $img.attr('src') || $img.attr('abs:src') || '';
        return {
          index,
          imageUrl: this.absUrl(src),
        } as Page;
      })
      .filter((p) => Boolean(p.imageUrl));
    return pages;
  }

  private parseStatus(raw?: string): Manga['status'] {
    if (!raw) return undefined;
    const s = raw.toLowerCase().trim();
    if (['ongoing', 'upcoming'].includes(s)) return 1;
    if (s === 'completed') return 0;
    if (['on_hold', 'on hold', 'hiatus'].includes(s)) return 2;
    if (['canceled', 'cancelled'].includes(s)) return 3;
    return undefined;
  }

  private parseDate(dateStr: string): number | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.getTime();
    // Fallback for "MMM d, yyyy"
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const m = dateStr.match(/([A-Za-z]+)\s+(\d+),\s+(\d{4})/);
    if (m) {
      const mon = months[m[1].substring(0, 3).toLowerCase()];
      if (mon !== undefined) {
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        return new Date(year, mon, day).getTime();
      }
    }
    return undefined;
  }
}
