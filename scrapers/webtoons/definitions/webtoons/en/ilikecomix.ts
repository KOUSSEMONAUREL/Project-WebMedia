import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/ilikecomix` (ILikeComix.kt).
 * The extension was renamed upstream from `Siren Scans FR` (fr, sirenscans.fr,
 * keyoapp theme) to `ILikeComix` (en, ilikecomix.com).
 *
 * - Popular: `/king-porn-comics/` (+ `/page/N/`)
 * - Search:  `/?s=<query>` (+ `/page/N`)
 * - List:    `article` — `h2.post-title a` (title + url), `figure.post-image img`
 * - Series:  `/<slug>/` — `h1.post-title`, `og:image`, `og:description`,
 *   genres `a[rel='tag']`
 * - Single chapter "Oneshot" (one-page comics)
 */
export class ILikeComixScraper extends BaseScraper {
  readonly name = 'ILikeComix';
  readonly baseUrl = 'https://ilikecomix.com';
  readonly lang = 'en';

  private parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('article').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('h2.post-title a').first();
      const href = $link.attr('href') || '';
      if (!$link.text().trim() || !href) return;
      const url = new URL(href).pathname.replace(/^\//, '').replace(/\/$/, '');
      const $img = $el.find('figure.post-image img').first();
      mangas.push({
        url,
        title: $link.text().trim(),
        thumbnailUrl: $img.attr('src') ? this.absUrl($img.attr('src') || '') : '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('a.nextp').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const path = page > 1 ? `/king-porn-comics/page/${page}/` : '/king-porn-comics/';
    const res = await this.get(path);
    return this.parseList(res.data as string);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) return { mangas: [], hasNextPage: false };
    const path = page > 1 ? `/page/${page}` : '/';
    const res = await this.get(`${path}?s=${encodeURIComponent(query.trim())}`);
    return this.parseList(res.data as string);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(`/${mangaUrl}/`);
    const $ = this.$(res.data as string);
    const title = $('h1.post-title').first().text().trim();
    if (!title) throw new Error(`Empty title for entry: ${mangaUrl}`);
    const genres = $('a[rel=\'tag\']')
      .map((_i, a) => $(a).text().trim())
      .get()
      .filter(Boolean)
      .join(', ');
    return {
      title,
      url: `/${mangaUrl}/`,
      thumbnailUrl: $('meta[property=\'og:image\']').first().attr('content') || '',
      description: $('meta[property=\'og:description\']').first().attr('content') || undefined,
      genre: genres || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ name: 'Oneshot', url: mangaUrl, chapterNumber: 1 }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`/${chapterUrl}/`);
    const $ = this.$(res.data as string);
    const figures = $('figure[data-pswp-src]').map((_i, el) => this.absUrl($(el).attr('data-pswp-src') || '')).get();
    const images = $('.entry-content img')
      .map((_i, img) => this.absUrl(
        $(img).attr('data-pswp-src') || $(img).attr('data-src')
          || $(img).attr('data-lazy-src') || $(img).attr('src') || '',
      ))
      .get();
    return [...figures, ...images]
      .filter((url) => url.startsWith('http') && url.includes('/comic/'))
      .filter((url, index, all) => all.indexOf(url) === index)
      .map((imageUrl, index) => ({ index, imageUrl }));
  }
}

export default ILikeComixScraper;
