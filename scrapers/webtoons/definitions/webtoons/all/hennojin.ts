import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `all/hennojin` (Hennojin.kt).
 *
 * WordPress gallery source shared by the `en` and `ja` upstream sources
 * (same baseUrl `https://hennojin.com`; the `ja` source additionally sends
 * `?archive=raw` on popular). Popular is the home grid, search requires the
 * rotating WordPress nonce (`input#_wpnonce`) fetched from `/home` first.
 * Each gallery exposes a single "Chapter" (`?view=multi` reader) whose pages
 * are `.slideshow-container > img`.
 */

export class HennojinScraper extends BaseScraper {
  readonly name = 'Hennojin';
  readonly baseUrl = 'https://hennojin.com';
  readonly lang = 'all';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/home/page/${page}`);
    return this.parseMangaList(res.data as string);
  }

  async getLatest(): Promise<SearchResult> {
    throw new Error('getLatest is not supported by Hennojin');
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    const home = await this.get(`${this.baseUrl}/home`);
    const $home = this.$(home.data as string);
    const nonce = $home('input#_wpnonce').first().attr('value') ?? '';
    const params = new URLSearchParams({ keyword: term, _wpnonce: nonce });
    const res = await this.get(`${this.baseUrl}/home/page/${page}?${params.toString()}`);
    return this.parseMangaList(res.data as string);
  }

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.grid-items .layer-content').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('.title_link > a').first();
      const href = $link.attr('href');
      if (!href) return;
      const img = $el.find('img').first();
      mangas.push({
        title: $link.text().trim(),
        url: this.stripDomain(href),
        thumbnailUrl: this.absUrl(img.attr('src') ?? ''),
        lang: this.lang,
        status: 0,
      });
    });
    return { mangas, hasNextPage: $('.paginate .next').length > 0 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const description = $('.manga-subtitle + p + p')
      .toArray()
      .map(p => {
        let text = '';
        $(p)
          .contents()
          .each((_i, node) => {
            if (node.type === 'tag' && (node as { tagName?: string }).tagName === 'br') {
              text += '\n';
            } else if (node.type === 'text') {
              text += (node as { data?: string }).data ?? '';
            } else {
              text += $(node).text();
            }
          });
        return text.replace(/\n /g, '\n').trim();
      })
      .filter(Boolean)
      .join('\n');
    const genre = $('.tags-list a[href*="/parody/"], .tags-list a[href*="/tags/"], .tags-list a[href*="/character/"]')
      .toArray()
      .map(a => $(a).text().trim())
      .filter(Boolean)
      .join(', ');
    const artist = $('.tags-list a[href*="/artist/"]').first().text().trim() || undefined;
    const author = $('.tags-list a[href*="/group/"]').first().text().trim() || artist;
    return {
      url: this.stripDomain(mangaUrl),
      lang: this.lang,
      description: description || undefined,
      genre: genre || undefined,
      artist,
      author,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data as string);
    const thumbSrc = $('.manga-thumbnail > img').first().attr('src');
    const dateUpload = await this.fetchLastModified(thumbSrc);
    const chapters: Chapter[] = [];
    $('a:contains("Read Online")').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      chapters.push({
        name: 'Chapter',
        url: this.stripDomain(this.withMultiView(href)),
        chapterNumber: -1,
        ...(dateUpload !== undefined ? { dateUpload } : {}),
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data as string);
    const pages: Page[] = [];
    $('.slideshow-container > img').each((index, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      pages.push({ index, imageUrl: this.absUrl(src) });
    });
    return pages;
  }

  private withMultiView(href: string): string {
    try {
      const u = new URL(href, this.baseUrl);
      u.searchParams.delete('view');
      u.searchParams.set('view', 'multi');
      return u.toString();
    } catch {
      return href;
    }
  }

  private async fetchLastModified(src: string | undefined): Promise<number | undefined> {
    if (!src) return undefined;
    try {
      const head = await this.client.head(this.absUrl(src), { validateStatus: () => true });
      const lastModified = (head.headers?.['last-modified'] as string | undefined) ?? undefined;
      if (!lastModified) return undefined;
      const time = Date.parse(lastModified);
      return Number.isNaN(time) ? undefined : time;
    } catch {
      return undefined;
    }
  }

  private stripDomain(href: string): string {
    try {
      const u = new URL(href, this.baseUrl);
      return u.pathname + u.search;
    } catch {
      return href;
    }
  }
}
