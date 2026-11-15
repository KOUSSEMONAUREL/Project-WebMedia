import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const PAGE_INTERVAL_MS = 2000;

export class AiriboxScraper extends BaseScraper {
  readonly name = 'Airibox';
  readonly baseUrl = 'https://airibox.top';
  readonly lang = 'all';

  private lastSiteRequest = 0;

  private async siteGet(url: string): Promise<{ data: unknown }> {
    const target = new URL(this.absUrl(url));
    if (target.hostname === new URL(this.baseUrl).hostname && !target.pathname.startsWith('/wp-content/')) {
      const wait = PAGE_INTERVAL_MS - (Date.now() - this.lastSiteRequest);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      this.lastSiteRequest = Date.now();
    }
    return this.get(target.toString());
  }

  private listUrl(page: number): string {
    return `${this.baseUrl}/` + (page > 1 ? `page/${page}/` : '');
  }

  private parsePosts($: CheerioAPI): Manga[] {
    return $('li.wp-block-post:has(h2.wp-block-post-title)')
      .toArray()
      .map(element => {
        const post = $(element);
        const link = post.find('h2 a').first();
        const href = link.attr('href') ?? '';
        const title = link.text().trim();
        if (!href || !title) return undefined;
        const image = post.find('.wp-block-post-content img').first();
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(image.attr('src') ?? ''),
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => Boolean(manga));
  }

  private async getPostList(url: string): Promise<SearchResult> {
    const res = await this.siteGet(url);
    const $ = this.$(String(res.data));
    return {
      mangas: this.parsePosts($),
      hasNextPage: $('a.wp-block-query-pagination-next').length > 0,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getPostList(this.listUrl(page));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPostList(this.listUrl(page));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.listUrl(page));
    url.searchParams.set('s', query.trim());
    return this.getPostList(url.toString());
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.siteGet(this.absUrl(mangaUrl));
    const $ = this.$(String(res.data));
    const images = $('.wp-block-post-content img').toArray();
    const title = $('h1.wp-block-post-title').first().text().trim();

    return {
      title: title || undefined,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: images[0] ? this.absUrl($(images[0]).attr('src') ?? '') : undefined,
      description: images.length > 0 ? `${images.length} photos` : undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.absUrl(mangaUrl);
    const res = await this.siteGet(url);
    const $ = this.$(String(res.data));
    const date = $('time').first().attr('datetime');
    return [
      {
        name: 'Chapter',
        url,
        dateUpload: date ? Date.parse(date) || undefined : undefined,
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.siteGet(this.absUrl(chapterUrl));
    const $ = this.$(String(res.data));
    return $('.wp-block-post-content img')
      .toArray()
      .map(element => this.absUrl($(element).attr('src') ?? ''))
      .filter(Boolean)
      .map((imageUrl, index) => ({ index, imageUrl }));
  }
}
