import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface MangaBoltListResponse {
  mangas: MangaBoltManga[];
  next_page_url?: string | null;
}

interface MangaBoltManga {
  name: string;
  slug: string;
  image_url?: string | null;
}

export class MangaBoltScraper extends BaseScraper {
  readonly name = 'MangaBolt';
  readonly baseUrl = 'https://mangabolt.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getMangaList(page, '');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.getMangaList(page, query.trim());
  }

  private async getMangaList(page: number, query: string): Promise<SearchResult> {
    let url = `${this.baseUrl}/manga-list/?page=${page}`;
    if (query) url += `&search=${encodeURIComponent(query)}`;
    url += '&_=/';
    const response = await this.get(url, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    });
    const data = response.data as MangaBoltListResponse;
    const mangas: Manga[] = (data.mangas ?? []).map((m) => ({
      url: `/manga/${m.slug}/`,
      title: m.name,
      thumbnailUrl: m.image_url ?? '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: data.next_page_url != null };
  }

  async getLatest(): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/latest`);
    const $ = this.$(response.data as string);
    const seen = new Set<string>();
    const mangas: Manga[] = [];
    $('div.bg-bg-secondary:has(a[href*="/chapter/"])').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href*="/chapter/"]').first().attr('href') ?? '';
      const slug = link.split('/chapter/')[1]?.split('-chapter-')[0] ?? '';
      if (!slug) return;
      const title = ($el.find('.font-bold').text().split('Chapter')[0] ?? '').trim();
      if (!title) return;
      const url = `/manga/${slug}/`;
      if (seen.has(url)) return;
      seen.add(url);
      mangas.push({
        url,
        title,
        thumbnailUrl: this.absUrl($el.find('img').first().attr('src') ?? ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data as string);
    const title = $('#main-content h1').first().text().trim();
    if (!title) throw new Error('Missing title');
    return {
      title,
      description: $('div.bg-bg-secondary div.px-6 div.flex-col div.text-text-muted').text().trim() || undefined,
      thumbnailUrl: this.absUrl($('div.flex img').first().attr('src') ?? ''),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data as string);
    const chapters: Chapter[] = [];
    $('div.w-full div.bg-bg-secondary:has(div.grid)').each((_, el) => {
      const $el = $(el);
      const link = $el.find('div.grid a').first();
      if (link.length === 0) return;
      let chName = link.text();
      const secondary = (link.parent().find('.text-xs').first().text() ?? '').trim();
      if (secondary && secondary.toLowerCase() !== 'read') {
        chName += ` - ${secondary}`;
      }
      const url = this.absUrl(link.attr('href') ?? '');
      if (!url) return;
      chapters.push({ name: chName, url });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data as string);
    const seen = new Set<string>();
    const urls: string[] = [];
    $('.js-pages-container img.js-page').each((_, el) => {
      const $img = $(el);
      if ($img.parents('noscript').length > 0) return;
      const raw = $img.is('[data-src]') ? ($img.attr('data-src') ?? '') : ($img.attr('src') ?? '');
      const url = this.absUrl(raw);
      if (!url || url.includes('data:image') || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    });
    return urls.map((imageUrl, index) => ({ imageUrl, index }));
  }
}
