import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

type Comic = {
  title: string;
  id: string;
  image_url?: string | null;
  long_description?: string | null;
  status?: string | null;
  type?: string | null;
  artist?: string | null;
  author?: string | null;
  serialization?: string | null;
  genre_id?: string | null;
};

const SLUG_REGEX = /[^a-z0-9]+/g;

function toSlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/'s/g, 's')
    .replace(/'/g, '')
    .replace(SLUG_REGEX, '-')
    .replace(/-ll-/g, 'll-')
    .replace(/^-|-$/g, '');
}

function parseStatus(s?: string | null): string | undefined {
  if (!s) return undefined;
  const v = s.toLowerCase();
  if (['ongoing', 'new season', 'mass released'].some(k => v.includes(k))) return 'ongoing';
  if (v.includes('completed')) return 'completed';
  if (v.includes('dropped')) return 'cancelled';
  if (v.includes('hiatus') || v.includes('on hold')) return 'hiatus';
  return v;
}

export class RizzComicScraper extends BaseScraper {
  readonly name = 'Rizz Comic';
  readonly baseUrl = 'https://rizzfables.com';
  readonly lang = 'en';
  private readonly mangaUrlDirectory = '/series';
  private urlMapCache: Map<string, string> | null = null;
  private urlMapFetchedAt = 0;

  private async fetchUrlMap(): Promise<Map<string, string>> {
    const res = await this.get(`${this.baseUrl}/series`);
    const $ = this.$(res.data);
    const map = new Map<string, string>();
    $('div.bsx a, #content div.soralist ul li a.series, a[href*="/series/r"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes('/series/')) return;
      const abs = this.absUrl(href);
      try {
        const url = new URL(abs);
        const slug = url.pathname.replace(/\/$/, '').split('/').pop() || '';
        if (!slug) return;
        const permaSlug = slug.replace(/^r\d+-/, '');
        if (permaSlug && slug !== permaSlug) {
          map.set(permaSlug, slug);
        }
      } catch {
        // ignore
      }
    });
    return map;
  }

  private async getUrlMap(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.urlMapCache && now - this.urlMapFetchedAt < 3600_000) return this.urlMapCache;
    try {
      const m = await this.fetchUrlMap();
      this.urlMapCache = m;
      this.urlMapFetchedAt = now;
      return m;
    } catch {
      return this.urlMapCache || new Map();
    }
  }

  private async resolveMangaUrl(mangaUrl: string): Promise<string> {
    // mangaUrl may be /series/<slug> or /series/<slug>/#id or permaSlug
    let slug = '';
    try {
      const u = new URL(this.absUrl(mangaUrl));
      slug = u.pathname.replace(/\/$/, '').split('/').pop() || '';
      slug = slug.replace(/^r\d+-/, '');
    } catch {
      slug = mangaUrl.split('/').pop() || '';
      slug = slug.replace(/^r\d+-/, '').split('#')[0];
    }
    if (!slug) return this.absUrl(mangaUrl);
    const map = await this.getUrlMap();
    const randomSlug = map.get(slug) || slug;
    return `${this.baseUrl}${this.mangaUrlDirectory}/${randomSlug}/`;
  }

  private apiHeaders(): Record<string, string> {
    return {
      'X-Requested-With': 'XMLHttpRequest',
      'X-API-Request': '1',
    };
  }

  private comicToManga(comic: Comic): Manga {
    const slug = toSlug(comic.title);
    const url = `${this.baseUrl}${this.mangaUrlDirectory}/${slug}/#${comic.id}`;
    const thumbnailUrl = comic.image_url ? `${this.baseUrl}/assets/images/${comic.image_url}` : '';
    const status = parseStatus(comic.status);
    return {
      title: comic.title,
      url,
      thumbnailUrl,
      description: comic.long_description || undefined,
      author: comic.author || comic.serialization || undefined,
      lang: this.lang,
      status: status as Manga['status'],
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    // upstream: if query nonempty POST live_search else filter_series with filters (we default to popular)
    if (query && query.trim().length > 0) {
      const params = new URLSearchParams();
      params.set('search_value', query.trim());
      const res = await this.post(`${this.baseUrl}/Index/live_search`, params.toString(), {
        headers: {
          ...this.apiHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
      });
      const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      const comics = Array.isArray(data) ? (data as Comic[]) : [];
      return { mangas: comics.map(c => this.comicToManga(c)), hasNextPage: false };
    }
    return this.getPopular(page);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    // use filter_series with OrderValue=popular
    const params = new URLSearchParams();
    params.set('OrderValue', 'popular');
    params.set('StatusValue', 'all');
    params.set('TypeValue', 'all');
    const res = await this.post(`${this.baseUrl}/Index/filter_series`, params.toString(), {
      headers: {
        ...this.apiHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
    });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const comics = Array.isArray(data) ? (data as Comic[]) : [];
    // Warm up URL map for subsequent manga fetches
    void this.getUrlMap().catch(() => {});
    return { mangas: comics.map(c => this.comicToManga(c)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const params = new URLSearchParams();
    params.set('OrderValue', 'latest');
    params.set('StatusValue', 'all');
    params.set('TypeValue', 'all');
    const res = await this.post(`${this.baseUrl}/Index/filter_series`, params.toString(), {
      headers: {
        ...this.apiHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
    });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const comics = Array.isArray(data) ? (data as Comic[]) : [];
    return { mangas: comics.map(c => this.comicToManga(c)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const resolved = await this.resolveMangaUrl(mangaUrl);
    const res = await this.get(resolved);
    const $ = this.$(res.data);

    const title = $('h1.entry-title').first().text().trim() || $('.entry-title').first().text().trim() || $('title').first().text().trim();
    const thumbnailUrl = this.absUrl($('.thumb img').first().attr('src') || $('.info-left img').first().attr('src') || $('.thumb img').first().attr('data-src') || '');
    let author = $('.imptdt:contains(Author) i').first().text().trim() || $('.tsinfo .imptdt:contains(Author) i').first().text().trim() || undefined;
    const artist = $('.imptdt:contains(Artist) i').first().text().trim() || undefined;
    if (artist && !author) author = artist;
    let description: string | undefined = $('.entry-content p').toArray().map(el => $(el).text().trim()).filter(Boolean).join('\n\n') || undefined;
    if (!description) description = $('.info-desc').first().text().trim() || $('.entry-content').first().text().trim() || undefined;
    const statusText = $('.imptdt:contains(Status) i, .imptdt:contains(Status)').first().text().trim() || undefined;

    return {
      title: title || mangaUrl,
      url: mangaUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      description: description || undefined,
      author,
      lang: this.lang,
      status: statusText ? (parseStatus(statusText) as Manga['status']) : undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const resolved = await this.resolveMangaUrl(mangaUrl);
    const res = await this.get(resolved);
    const $ = this.$(res.data);
    const selector = '#chapterlist li, .eplister li, div.bxcl li, ul li:has(div.chbox):has(div.eph-num)';
    return $(selector).toArray().map(el => {
      const $el = $(el);
      const a = $el.find('a').first();
      const url = this.absUrl(a.attr('href') || '');
      const name = $el.find('.chapternum').first().text().trim() || a.text().trim();
      const dateText = $el.find('.chapterdate').first().text().trim();
      const dateUpload = dateText ? this.parseDate(dateText) : undefined;
      return { name: name || url, url, dateUpload };
    }).filter(c => c.url);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const imgs = $('div#readerarea img, #readerarea img').toArray();
    const pages: Page[] = imgs.map((el, i) => {
      const src = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src') || '';
      if (!src) return null;
      return { index: i, imageUrl: this.absUrl(src) };
    }).filter(Boolean) as Page[];
    if (pages.length > 0) return pages;
    // fallback JSON image list
    const html = $.html();
    const match = html.match(/"images"\s*:\s*(\[.*?\])/);
    if (match && match[1]) {
      try {
        const list = JSON.parse(match[1]) as string[];
        return list.map((u, i) => ({ index: i, imageUrl: this.absUrl(u) }));
      } catch {
        return [];
      }
    }
    return [];
  }

  private parseDate(dateStr: string): number | undefined {
    const d = new Date(dateStr.trim());
    if (!isNaN(d.getTime())) return d.getTime();
    // try dd MMM yyyy
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length === 3) {
      const d2 = new Date(`${parts[1]} ${parts[0]}, ${parts[2]}`);
      if (!isNaN(d2.getTime())) return d2.getTime();
    }
    return undefined;
  }
}
