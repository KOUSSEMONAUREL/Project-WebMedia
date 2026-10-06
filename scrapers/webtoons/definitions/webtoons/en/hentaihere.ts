import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface ReaderData {
  images: string[];
}

const DETAIL_TYPES = new Set(['doujinshi', 'original', 'imageset', 'm']);
const LEGACY_MANGA_URL = /^\/m\/(\d+)$/;
const CHAPTER_NUMBER = /Chapter\s+([\d.]+)/;

export class HentaiHereScraper extends BaseScraper {
  readonly name = 'HentaiHere';
  readonly baseUrl = 'https://hentaihere.com';
  readonly lang = 'en';

  /** Legacy entries stored the pre-redesign `/m/{id}` path; the site only serves `/doujinshi/{id}` now. */
  private mangaUrl(url: string): string {
    const path = url.startsWith(this.baseUrl) ? url.slice(this.baseUrl.length) : url;
    return this.baseUrl + path.replace(LEGACY_MANGA_URL, '/doujinshi/$1');
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const suffix = page > 1 ? `/page-${page}` : '';
    const res = await this.get(`/browse/newest${suffix}`);
    return this._parseList(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    let path: string;
    if (query) {
      path = `/search?q=${encodeURIComponent(query)}&page=${page}`;
    } else {
      path = page > 1 ? `/browse/newest/page-${page}` : '/browse/newest';
    }
    const res = await this.get(path);
    return this._parseList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.mangaUrl(mangaUrl));
    const $ = this.$(res.data);
    const details = $('dl[aria-label=Details]');
    const detail = (label: string): string | undefined => {
      const dd = details.find('dt').filter((_, el) => $(el).text().trim() === label).first().next('dd');
      const text = dd.text().trim();
      return text || undefined;
    };
    const statusRaw = detail('Status')?.toLowerCase();
    const status: MangaStatus = statusRaw === 'completed' ? 2 : statusRaw === 'ongoing' ? 1 : 0;
    return {
      title: $('h1#book-title').first().text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('meta[property=og:image]').first().attr('content') || ''),
      author: detail('Artist') ?? detail('Author'),
      status,
      genre: $('ul[aria-label=Tags] a').map((_, el) => $(el).text().trim()).get().filter((t) => t.length > 0).join(', '),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.mangaUrl(mangaUrl));
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('#preview-chapter option').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('data-read') ?? '';
      const name = $el.text().replace(/\(latest\)\s*$/, '').trim();
      if (!name || !href) return;
      const num = CHAPTER_NUMBER.exec(name)?.[1];
      chapters.push({
        name,
        url: this.absUrl(href),
        chapterNumber: num !== undefined ? Number.parseFloat(num) : -1,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const raw = $('script[data-reader-data]').first().html();
    if (!raw) return [];
    try {
      const data = JSON.parse(raw) as ReaderData;
      if (!Array.isArray(data.images)) return [];
      return data.images.map((imageUrl, i) => ({ index: i, imageUrl }));
    } catch {
      return [];
    }
  }

  /** Returns null for foreign hosts; `m` is the legacy detail path, kept so old links still resolve. */
  getMangaByUrl(url: string): { type: string; slug: string } | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.host !== new URL(this.baseUrl).host) return null;
    const [type, slug] = parsed.pathname.split('/').filter(Boolean);
    if (!type || !slug || !DETAIL_TYPES.has(type)) return null;
    return { type, slug };
  }

  private _parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('article.card[data-card]').each((_, el) => {
      const $el = $(el);
      const href = $el.find('a').first().attr('href') ?? '';
      const title = $el.find('h3').first().text().trim();
      const thumb = $el.find('img').first().attr('src') ?? '';
      if (title && href) mangas.push({ title, url: this.absUrl(href).replace(this.baseUrl, ''), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    const hasNextPage = $('a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }
}
