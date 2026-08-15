import { createHash } from 'node:crypto';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class VyvyMangaScraper extends BaseScraper {
  readonly name = 'VyvyManga';
  readonly baseUrl = 'https://mangavyvy.net';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = page === 1 ? '/search' : `/search?page=${page}`;
    return this.parseMangasPage((await this.get(url)).data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = `/search?sort=updated_at${page === 1 ? '' : `&page=${page}`}`;
    return this.parseMangasPage((await this.get(url)).data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.parseMangasPage((await this.get('/search', { params: { q: query, page } })).data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const status = $('.pre-title:contains(Status) ~ span:not(.space)').first().text().trim();
    return {
      title: $('h1').first().text().trim() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.img-manga img').first().attr('src') || ''),
      description: $('.summary > .content').text().trim() || undefined,
      author: $('.pre-title:contains(Author) ~ a').first().text().trim() || undefined,
      artist: $('.pre-title:contains(Artist) ~ a').first().text().trim() || undefined,
      genre: $('.pre-title:contains(Genres) ~ a')
        .map((_, el) => $(el).text().trim())
        .get()
        .join(', '),
      status: status === 'Ongoing' ? 1 : status === 'Completed' ? 2 : 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('.list-group > a').each((_, el) => {
      const title = $(el).find('span').first().text().trim();
      const href = $(el).attr('href') ?? '';
      const dateText = $(el).find('> p').first().text().trim();
      if (title && href) {
        const dateUpload = this.parseChapterDate(dateText);
        const hash = createHash('md5')
          .update(`${dateUpload ?? 0}:${title}`)
          .digest('hex')
          .slice(-10);
        chapters.push({ name: title, url: `${hash}#${this.absUrl(href)}`, dateUpload });
      }
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = chapterUrl.split('#')[1] ?? chapterUrl;
    const res = await this.get(url);
    const $ = this.$(res.data);
    return $('img.d-block')
      .map((index, el) => ({ index, imageUrl: this.absUrl($(el).attr('data-src') || '') }))
      .get();
  }

  private parseMangasPage(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.comic-item').each((_, el) => {
      const href = $(el).find('a').first().attr('href') ?? '';
      const title = $(el).find('.comic-title').first().text().trim();
      const thumb = $(el).find('.comic-image img.image.lozad').first().attr('data-src') || '';
      if (href && title) {
        mangas.push({ title, url: this.absUrl(href), thumbnailUrl: this.absUrl(thumb), lang: this.lang });
      }
    });
    return { mangas, hasNextPage: $('[rel=next]').length > 0 };
  }

  private parseChapterDate(date: string): number | undefined {
    if (!date) return undefined;
    if (date.endsWith('ago')) {
      const number = /(\d+)/.exec(date)?.[1];
      const amount = number ? parseInt(number, 10) : NaN;
      if (!Number.isNaN(amount)) {
        const now = Date.now();
        if (date.includes('day')) return now - amount * 86_400_000;
        if (date.includes('hour')) return now - amount * 3_600_000;
        if (date.includes('minute')) return now - amount * 60_000;
        if (date.includes('second')) return now - amount * 1_000;
      }
      return undefined;
    }
    const ts = Date.parse(date);
    return Number.isNaN(ts) ? undefined : ts;
  }
}