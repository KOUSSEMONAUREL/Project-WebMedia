import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

export class PornStickyScraper extends BaseScraper {
  readonly name = 'PornSticky';
  readonly baseUrl = 'https://pornsticky.com';
  readonly lang = 'all';

  private listUrl(segments: string[], page: number): string {
    const path = segments.map(segment => encodeURIComponent(segment)).join('/');
    return `${this.baseUrl}/${path}/${page > 1 ? `${page}/` : ''}`;
  }

  private parseCards(html: string): Manga[] {
    const $ = this.$(html);
    const mangas: Manga[] = [];

    $("#container > li > a[href*='/pics/']").each((_, element) => {
      const link = $(element);
      const href = link.attr('href') ?? '';
      const rawTitle = (link.attr('title') ?? '').trim();
      if (!href) return;

      const id = href.replace(/\/+$/, '').split('/').pop()?.split('-').pop() ?? '';
      const title = id && rawTitle.endsWith(` ${id}`) ? rawTitle.slice(0, rawTitle.length - id.length - 1).trim() : rawTitle;
      const img = link.find('img').first();

      mangas.push({
        title: title || rawTitle,
        url: href,
        thumbnailUrl: this.absUrl(img.attr('data-src') ?? img.attr('src') ?? ''),
        lang: this.lang,
      });
    });

    return mangas;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl(['search', 'porn'], page));
    const $ = this.$(res.data);
    const mangas = this.parseCards(res.data);
    const hasNextPage = $('a.next').length > 0 || ($('.pagination').length === 0 && mangas.length >= 160);
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const slug = query
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .replace(/ +/g, '-');
    if (!slug) return this.getPopular(page);

    const res = await this.get(this.listUrl(['search', slug], page));
    const $ = this.$(res.data);
    const mangas = this.parseCards(res.data);
    const hasNextPage = $('a.next').length > 0 || ($('.pagination').length === 0 && mangas.length >= 160);
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const title = $('.breadcrumbs h1').first().text().trim() || $('h1').first().text().trim();
    const artist = $('.breadcrumbs a').first().text().trim();
    const author = ($('[data-models-related]').attr('data-models-related') ?? '').trim();

    const genres: string[] = [];
    $('.content-categories a').each((_, element) => {
      const link = $(element);
      if (link.hasClass('person')) return;
      const genre = link.text().trim();
      if (genre) genres.push(genre);
    });

    const firstImage = $("#container > li > a.ss-image img").first();
    const thumbnailUrl =
      firstImage.attr('data-src') ??
      firstImage.attr('src') ??
      $("meta[property='og:image']").attr('content') ??
      '';
    const description = ($("meta[name='description']").attr('content') ?? '').trim();

    return {
      title,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: author || undefined,
      artist: artist || undefined,
      genre: genres.join(', ') || undefined,
      description: description || undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const details = await this.getMangaDetails(mangaUrl);
    return [
      {
        name: details.title ?? 'Gallery',
        url: this.absUrl(mangaUrl),
        chapterNumber: 1,
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    const images: string[] = [];
    const seen = new Set<string>();
    $("#container > li > a.ss-image").each((_, element) => {
      const href = $(element).attr('href') ?? '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      images.push(this.absUrl(href));
    });

    return images.map((imageUrl, index) => ({ imageUrl, index }));
  }
}
