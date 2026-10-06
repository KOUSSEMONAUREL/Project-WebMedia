import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const SERIES_PATH = /^\/[^/]+$/;
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4']);
const CHAPTER_NUMBER = /\d+(\.\d+)?/;

export class SnafuComicScraper extends BaseScraper {
  readonly name = 'Snafu Comics';
  readonly baseUrl = 'https://www.snafu-comics.com';
  readonly lang = 'en';

  private toPath(href: string): string | null {
    const trimmed = href.trim();
    if (trimmed.startsWith('/')) return trimmed;
    if (trimmed.startsWith(this.baseUrl)) {
      const path = trimmed.slice(this.baseUrl.length);
      return path || '/';
    }
    return null;
  }

  private async catalogEntries(): Promise<Map<string, Manga>> {
    const res = await this.get('/all-comics');
    const $ = this.$(res.data);
    const entries = new Map<string, Manga>();
    $('a[href]').each((_, el) => {
      const $el = $(el);
      const path = this.toPath($el.attr('href') ?? '');
      if (!path || !SERIES_PATH.test(path)) return;
      const img = $el.find('img').first();
      if (img.length === 0) return;
      // NOTE: cheerio `.text()` concatenates block elements without spaces
      // (Jsoup inserts them), so "Title"+"by Author" may read "Titleby Author".
      // Prefer the explicit tile divs; keep the upstream ` by ` check as fallback.
      const tileTitle = $el.find('.home-tile-title').first().text().replace(/\s+/g, ' ').trim();
      const tileAuthor = $el.find('.home-tile-author').first().text().replace(/\s+/g, ' ').trim();
      const slug = path.slice(1);
      const title = (img.attr('alt') ?? '').trim() || tileTitle;
      if (!title) return;
      let author: string | undefined;
      if (tileAuthor) {
        author = tileAuthor.replace(/^by\s+/i, '').trim() || undefined;
      } else {
        const text = $el.text().replace(/\s+/g, ' ').trim();
        if (!text.includes(' by ')) return;
        author = text.split(' by ').slice(1).join(' by ').trim() || undefined;
      }
      const thumb = img.attr('abs:src') || img.attr('src') || '';
      if (!entries.has(slug)) {
        entries.set(slug, {
          title,
          url: `/${slug}`,
          thumbnailUrl: this.absUrl(thumb),
          author,
          lang: this.lang,
        });
      }
    });
    return entries;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const entries = await this.catalogEntries();
    return { mangas: [...entries.values()], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const entries = await this.catalogEntries();
    const normalized = query.trim().toLowerCase();
    if (!normalized) return { mangas: [...entries.values()], hasNextPage: false };
    const mangas = [...entries.values()].filter(
      (m) => m.title.toLowerCase().includes(normalized) || (m.author ?? '').toLowerCase().includes(normalized),
    );
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.replace(/^\/+/, '').split('/')[0];
    const entries = await this.catalogEntries();
    const entry = entries.get(slug);
    if (!entry) throw new Error(`Series not found in catalog: ${mangaUrl}`);
    return entry;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace(/^\/+/, '').split('/')[0];
    const res = await this.get(`/${slug}/archive`);
    const $ = this.$(res.data);
    const heading = $('h1, h2, h3, h4')
      .filter((_, el) => $(el).text().trim().toLowerCase() === 'archive')
      .first();
    const found: Array<{ href: string; text: string }> = [];
    if (heading.length > 0) {
      let sibling = heading.next();
      while (sibling.length > 0 && !HEADING_TAGS.has(sibling.get(0)?.tagName.toLowerCase() ?? '')) {
        sibling.find('a[href]').each((_, el) => {
          found.push({ href: $(el).attr('href') ?? '', text: $(el).text() });
        });
        if (sibling.is('a[href]')) found.push({ href: sibling.attr('href') ?? '', text: sibling.text() });
        sibling = sibling.next();
      }
    } else {
      $('a[href]').each((_, el) => {
        found.push({ href: $(el).attr('href') ?? '', text: $(el).text() });
      });
    }
    const chapterPath = new RegExp(`^/${slug}/.+`);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    for (const { href, text } of found) {
      const path = this.toPath(href);
      if (!path || !chapterPath.test(path) || seen.has(path)) continue;
      seen.add(path);
      const clean = text.replace(/\s+/g, ' ').trim();
      const name = clean || path.split('/').pop() || path;
      const chapter: Chapter = { name, url: path };
      const num = CHAPTER_NUMBER.exec(name)?.[0];
      if (num !== undefined) chapter.chapterNumber = Number.parseFloat(num);
      chapters.push(chapter);
    }
    if (chapters.length > 0) return chapters;
    const options: Chapter[] = [];
    const seenOpt = new Set<string>();
    $('select option[value]').each((_, el) => {
      const value = ($(el).attr('value') ?? '').trim();
      if (!value) return;
      // Option values are site-root-relative (`changePage` prepends the origin),
      // e.g. `powerpuffgirls/ppg-chapter-1` -> `/powerpuffgirls/ppg-chapter-1`.
      // (Upstream falls back to `/$slug/$value` here, which doubles the slug.)
      const url = this.toPath(value) ?? (value.includes('/') ? `/${value}` : `/${slug}/${value}`);
      if (seenOpt.has(url)) return;
      seenOpt.add(url);
      options.push({ name: $(el).text().replace(/\s+/g, ' ').trim() || value, url });
    });
    return options;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    try {
      const res = await this.get(chapterUrl);
      const $ = this.$(res.data);
      return $('img[src*="/comics/"]')
        .map((i, el) => ({ index: i, imageUrl: this.absUrl($(el).attr('abs:src') || $(el).attr('src') || '') }))
        .get()
        .filter((p) => p.imageUrl.length > 0);
    } catch {
      return [];
    }
  }
}
