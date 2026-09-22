import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

interface ChapterDto {
  chapter_name: string;
  chapter_slug: string;
  updated_at: string | null;
}

interface ChapterListResponse {
  success: boolean;
  data: ChapterDto[];
}

function toStatus(text: string | null | undefined): MangaStatus {
  const v = text?.trim().toLowerCase();
  switch (v) {
    case 'ongoing':
    case 'releasing':
      return 1;
    case 'completed':
      return 0;
    case 'on hiatus':
    case 'on_hiatus':
      return 3;
    case 'discontinued':
    case 'cancelled':
      return 3;
    default:
      return 3;
  }
}

export class BbatoScraper extends BaseScraper {
  readonly name = 'Bbato';
  readonly baseUrl = 'https://bato1.com';
  readonly lang = 'en';

  private parseMangasPage($: CheerioAPI): SearchResult {
    const mangas: Manga[] = $('.original.card-lg .unit')
      .toArray()
      .map((element) => {
        const $el = $(element);
        const poster = $el.find('a.poster').first();
        const href = poster.attr('href') || '';
        const title = $el.find('.info > a').first().text().trim();
        if (!href || !title) return null;
        const thumb = poster.find('img').first().attr('data-src') || poster.find('img').first().attr('src') || '';
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(thumb),
          lang: this.lang,
        } as Manga;
      })
      .filter((m): m is Manga => m !== null);

    const hasNextPage = $('.pagination a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const path = page === 1 ? '/filter?sort=views' : `/filter?sort=views&page=${page}`;
    const res = await this.get(path);
    return this.parseMangasPage(this.$(res.data));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const path = page === 1 ? '/updated' : `/updated/page/${page}`;
    const res = await this.get(path);
    return this.parseMangasPage(this.$(res.data));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('keyword', query.trim());
    if (page > 1) params.set('page', page.toString());
    const qs = params.toString();
    const url = `/filter${qs ? `?${qs}` : ''}`;
    const res = await this.get(url);
    return this.parseMangasPage(this.$(res.data));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    const title = $('h1[itemprop=name]').first().text().trim();
    if (!title) throw new Error('Missing title');
    const author = $('.meta div:has(span:contains(Author)) a')
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean)
      .join(', ');
    const description = $('.description').first().text().trim() || undefined;
    const genre = $('.meta div:has(span:contains(Genres)) a')
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean)
      .join(', ');
    const statusText = $('.info > p').first().text().trim();
    const thumb = $('.poster img').first().attr('data-src') || $('.poster img').first().attr('src') || '';
    return {
      title,
      url: this.absUrl(mangaUrl).split('?')[0],
      thumbnailUrl: this.absUrl(thumb),
      author: author || undefined,
      description,
      genre: genre || undefined,
      status: toStatus(statusText),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.absUrl(mangaUrl).split('/').pop()?.split('?')[0]?.split('#')[0] || '';
    if (!slug) return [];
    const res = await this.get(`/get-chapter-list?slug=${encodeURIComponent(slug)}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: this.absUrl(mangaUrl),
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });
    let json: ChapterListResponse;
    if (typeof res.data === 'string') {
      json = JSON.parse(res.data) as ChapterListResponse;
    } else {
      json = res.data as ChapterListResponse;
    }
    const list: ChapterDto[] = json.data || [];
    return list.map((dto) => {
      const dateUpload = dto.updated_at ? Date.parse(dto.updated_at.replace(' ', 'T') + 'Z') : undefined;
      return {
        name: dto.chapter_name,
        url: this.absUrl(`/read/${slug}/${dto.chapter_slug}`),
        dateUpload: dateUpload !== undefined && !isNaN(dateUpload) ? dateUpload : undefined,
      } as Chapter;
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('.pages .page:not(.notice-page) img').each((index, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src') || '';
      if (!src) return;
      // Skip placeholder data: URIs
      if (src.startsWith('data:')) {
        const dataSrc = $(el).attr('data-src');
        if (!dataSrc || dataSrc.startsWith('data:')) return;
        pages.push({ index: pages.length, imageUrl: this.absUrl(dataSrc) });
        return;
      }
      pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
    });
    // Fallback: some images lazyload via data-src only and initial src is placeholder
    if (pages.length === 0) {
      $('.pages .page img').each((_, el) => {
        const $img = $(el);
        if ($img.closest('.notice-page').length) return;
        const src = $img.attr('data-src') || $img.attr('src') || '';
        if (!src || src.startsWith('data:')) return;
        pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
      });
    }
    // Ensure indices sequential
    return pages.map((p, i) => ({ ...p, index: i }));
  }
}
