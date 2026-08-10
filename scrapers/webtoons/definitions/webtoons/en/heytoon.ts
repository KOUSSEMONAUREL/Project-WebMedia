import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface Comic {
  linkComic: string;
  title: string;
  raw_thumb?: string | null;
}

export class HeytoonScraper extends BaseScraper {
  readonly name = 'ToonHey';
  readonly baseUrl = 'https://toonhey.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    if (page === 1) {
      const res = await this.get(this.baseUrl);
      const $ = this.$(res.data);
      const mangas = $('section').toArray()
        .filter(sec =>
          /slider/i.test($(sec).attr('class') || '') &&
          /popular|trending/i.test($(sec).find('h2').first().text())
        )
        .flatMap(sec => $(sec).find('a').toArray())
        .map(el => {
          const a = $(el);
          const img = a.find('img[alt!=badge]').first();
          return {
            title: a.text().trim(),
            url: this.absUrl(a.attr('href') || ''),
            thumbnailUrl: this.absUrl(img.attr('data-src') || ''),
            lang: this.lang,
          };
        });
      return { mangas, hasNextPage: true };
    }
    return this.genresParse(await this.genresFetch(page - 1, 'views'));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.genresParse(await this.genresFetch(page, 'latest'));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) {
      return this.genresParse(await this.genresFetch(page, 'latest'));
    }
    const params = new URLSearchParams({ keyword: query });
    const res = await this.get(`${this.baseUrl}/api/complete-search?${params.toString()}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const data = typeof res.data === 'string' ? (JSON.parse(res.data) as Comic[]) : (res.data as Comic[]);
    const mangas = (Array.isArray(data) ? data : []).map(comic => ({
      title: comic.title || '',
      url: this.absUrl(comic.linkComic || ''),
      thumbnailUrl: comic.raw_thumb ? this.absUrl(comic.raw_thumb) : '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const manga: Partial<Manga> = {
      title: $('#titleSubWrapper h1.titCon').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: $('meta[property=og:image]').attr('content') || '',
      lang: this.lang,
    };
    const description = $('#modal_detail .cont_area p').first().text().trim();
    if (description) manga.description = description;
    const genre = $('#modal_detail a[href*=genres]').toArray()
      .map(el => $(el).text().trim())
      .filter(Boolean)
      .join(', ');
    if (genre) manga.genre = genre;
    const badges = $('.badgeArea span').toArray().map(el => $(el).text().trim());
    if (badges.some(b => b.includes('Up'))) manga.status = 1;
    else if (badges.some(b => b.includes('Completed'))) manga.status = 2;
    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters = $('.episodeListConPC a#episodeItemCon').toArray().map(el => {
      const a = $(el);
      return {
        name: a.find('.comicInfo p.episodeStitle').first().text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        dateUpload: this.parseChapterDate(a.find('.comicInfo .episodeDate').first().text().trim()),
      };
    });
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('#comicContent img').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }

  private async genresFetch(page: number, orderBy: string): Promise<string> {
    const params = new URLSearchParams({ orderBy });
    if (page > 1) params.set('page', String(page));
    const res = await this.get(`${this.baseUrl}/en/genres?${params.toString()}`);
    return res.data;
  }

  private genresParse(html: string): SearchResult {
    const $ = this.$(html);
    const mangas = $('div[class*=comicItem] a').toArray().map(el => {
      const a = $(el);
      const img = a.find('img[alt!=badge]').first();
      return {
        title: img.attr('title') || a.text().trim(),
        url: this.absUrl(a.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('data-src') || ''),
        lang: this.lang,
      };
    });
    const hasNextPage = $('.wp-pagenavi .nextpostslink').length > 0;
    return { mangas, hasNextPage };
  }

  private parseChapterDate(text: string): number {
    if (!text) return 0;
    const d = new Date(text.trim());
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
}
