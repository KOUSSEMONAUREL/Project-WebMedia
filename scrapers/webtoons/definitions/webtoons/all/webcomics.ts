import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const COMIC_RE = /^\/en\/comic\/([^\/]+)\/([0-9a-f]+)$/;

export class WebcomicsScraper extends BaseScraper {
  override readonly name = 'WebComics';
  override readonly baseUrl = 'https://webcomicsapp.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    // WebComics is a client-paginated Nuxt site: the server renders the first
    // page of the catalogue on the homepage. Further pages are only reachable
    // through the client, so we serve the homepage listing for any page and
    // advertise a next page (the catalogue clearly extends beyond one screen).
    const res = await this.get(page === 1 ? '/' : `/?page=${page}`);
    return this.parseCards(res.data, page === 1 ? true : false);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    // No server-side search endpoint (the `/search` route 404s; search is
    // client-side). Filter the server-rendered catalogue instead.
    const q = query.trim().toLowerCase();
    if (!q) return this.getPopular(page);
    const res = await this.get('/');
    const all = this.parseCards(res.data, false).mangas;
    const mangas = all.filter((m) => m.title.toLowerCase().includes(q));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title =
      $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || '';
    const thumbnailUrl = $('meta[property="og:image"]').attr('content') || '';
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';
    const genre = $('.meta-tags > a, .meta-category a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join(', ');
    return {
      title: title || undefined,
      url: mangaUrl,
      thumbnailUrl: thumbnailUrl || undefined,
      description: description || undefined,
      genre: genre || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const path = mangaUrl.startsWith(this.baseUrl) ? mangaUrl.slice(this.baseUrl.length) : mangaUrl;
    const m = path.match(COMIC_RE);
    if (!m) return [];
    const [, slug, id] = m;
    const res = await this.get(`/en/chapters/${slug}/${id}`);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    $('a[href^="/en/action/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const mm = href.match(/^\/en\/action\/[^\/]+\/(\d+)\/[0-9a-f]+$/);
      if (!mm || seen.has(href)) return;
      seen.add(href);
      const n = Number(mm[1]);
      chapters.push({ name: `Ch. ${n}`, url: this.absUrl(href), chapterNumber: n });
    });
    chapters.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    return this.parsePages(res.data);
  }

  private parsePages(html: string): Page[] {
    const payload = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!payload) return [];
    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return [];
    }
    if (!Array.isArray(data)) return [];

    const resolve = (value: unknown, depth = 0): unknown => {
      if (depth > 8) return value;
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < data.length) {
        return resolve(data[value], depth + 1);
      }
      if (Array.isArray(value)) return value.map(item => resolve(item, depth + 1));
      if (value !== null && typeof value === 'object') {
        const resolved: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) resolved[key] = resolve(item, depth + 1);
        return resolved;
      }
      return value;
    };

    const chapter = data.find((entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'images' in entry);
    if (!chapter) return [];

    const images = resolve(chapter.images);
    const base = resolve(chapter.base_url);
    if (!Array.isArray(images)) return [];

    const pages: Page[] = [];
    const seen = new Set<string>();
    for (const image of images) {
      if (image === null || typeof image !== 'object') continue;
      const url = (image as Record<string, unknown>).url;
      if (typeof url !== 'string' || url === '') continue;
      const imageUrl = /^https?:\/\//i.test(url)
        ? url
        : this.absUrl(`${typeof base === 'string' ? base : ''}${url}`);
      if (seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      pages.push({ index: pages.length, imageUrl });
    }
    return pages;
  }

  private parseCards(html: string, hasNext: boolean): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    const seen = new Set<string>();
    $('a[href^="/en/comic/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      if (!COMIC_RE.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);
      const title =
        $el.find('span.text-ink.truncate, .truncate').first().text().trim() ||
        $el.find('img').attr('alt') ||
        '';
      if (!title) return;
      mangas.push({ title, url: this.absUrl(href), thumbnailUrl: '', lang: this.lang });
    });
    return { mangas, hasNextPage: hasNext };
  }
}
