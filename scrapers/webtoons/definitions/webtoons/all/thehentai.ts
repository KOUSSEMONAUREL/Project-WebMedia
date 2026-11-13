import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

export class TheHentaiScraper extends BaseScraper {
  readonly name = 'TheHentai';
  readonly baseUrl = 'https://thehentai.net';
  readonly lang = 'all';

  private pagePath(page: number): string {
    return page > 1 ? `/page/${page}/` : '/';
  }

  private parseCards(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];

    $("#posts_list .gridPosts:has(h3 a[href^='/']):not(:has(a[href*='/category/videos/']))").each((_, element) => {
      const card = $(element);
      const link = card.find('h3 a').first();
      const href = link.attr('href') ?? '';
      const title = link.text().trim();
      if (!href || !title) return;

      mangas.push({
        title,
        url: href,
        thumbnailUrl: this.absUrl(card.find('.img_cage img').first().attr('src') ?? ''),
        lang: this.lang,
      });
    });

    const current = $('.pagination .current_page').closest('li');
    const hasNextPage =
      current.length > 0
        ? current
            .nextAll('li')
            .find('a')
            .toArray()
            .some(element => /^\d+$/.test($(element).text().trim()))
        : $('.pagination a').length > 0;

    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.pagePath(page));
    return this.parseCards(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.baseUrl);
    if (page > 1) url.pathname = `/page/${page}/`;
    if (query.trim()) url.searchParams.set('s', query.trim());

    const res = await this.get(url.toString());
    return this.parseCards(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const title = $('.post_title span').first().text().trim();
    const artist = $('.tdArtist a')
      .map((_, element) => $(element).text().trim().replace(/^@/, ''))
      .get()
      .filter(Boolean)
      .join(', ');

    const genres: string[] = [];
    $('.tdCategory a, .tdTag a').each((_, element) => {
      const genre = $(element).text().trim().replace(/^#/, '');
      if (genre) genres.push(genre);
    });

    const pagesCount = $('.post_imgs .thumbnails').length;
    const thumbnailUrl =
      $("meta[property='og:image']").attr('content') ??
      $('.post_imgs .thumbnails img').first().attr('src') ??
      '';

    return {
      title,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: artist || undefined,
      artist: artist || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      description: pagesCount > 0 ? `${pagesCount} pages` : undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    if ($('.post_imgs .thumbnails a').length === 0) return [];

    return [
      {
        name: 'Chapter',
        url: this.absUrl(mangaUrl),
        chapterNumber: 1,
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    const pageUrls: string[] = [];
    const seen = new Set<string>();
    $('.post_imgs .thumbnails a').each((_, element) => {
      const href = $(element).attr('href') ?? '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      pageUrls.push(this.absUrl(href));
    });

    const pages: Page[] = [];
    for (const pageUrl of pageUrls) {
      const pageRes = await this.get(pageUrl);
      const page$ = this.$(pageRes.data);
      const media = page$('#img_gallery_big').first();
      const imageUrl = media.is('video')
        ? page$("meta[property='og:image']").attr('content') ?? media.attr('src') ?? ''
        : media.attr('src') ?? page$("meta[property='og:image']").attr('content') ?? '';
      if (imageUrl) pages.push({ imageUrl: this.absUrl(imageUrl), index: pages.length });
    }

    return pages;
  }
}
