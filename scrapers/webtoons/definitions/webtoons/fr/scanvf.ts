import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ScanVFScraper extends BaseScraper {
  readonly name = 'Scan VF';
  readonly baseUrl = 'https://www.scan-vf.net';
  readonly lang = 'fr';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/filterList?page=${page}&sortBy=views&asc=false`);
    return this.parseList(res.data, page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/latest-release?page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('div.mangalist div.manga-item').each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const title = a.text().trim();
      const url = this.absUrl(a.attr('href') || '');
      const thumbnailUrl = this.absUrl($el.find('img').first().attr('src') || '');
      if (title && url) mangas.push({ title, url, thumbnailUrl, lang: this.lang });
    });
    const hasNextPage = $('.pagination a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.get(`/search?query=${encodeURIComponent(query)}`);
    const mangas: Manga[] = [];
    try {
      const data = JSON.parse(res.data);
      const suggestions = data.suggestions || [];
      for (const item of suggestions) {
        const title = item.value || '';
        const url = this.absUrl(`/${item.data}`);
        mangas.push({ title, url, thumbnailUrl: '', lang: this.lang });
      }
    } catch {}
    return { mangas, hasNextPage: false };
  }

  private parseList(html: string, _page: number): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.media').each((_, el) => {
      const $el = $(el);
      const a = $el.find('h5.media-heading a, a.chart-title').first();
      const title = a.text().trim();
      const url = this.absUrl(a.attr('href') || '');
      const thumbnailUrl = this.absUrl($el.find('img').first().attr('src') || '');
      if (title && url) mangas.push({ title, url, thumbnailUrl, lang: this.lang });
    });
    const hasNextPage = $('.pagination a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.listmanga-header, .widget-title').first().text().trim();
    const thumbnailUrl = this.absUrl($('.row img.img-responsive').first().attr('src') || '');
    const description = $('.row .well').first().text().trim();
    let author: string | undefined;
    let genre: string | undefined;
    let status: import('../../../engine/types').MangaStatus;
    $('.row .dl-horizontal dt').each((_, dt) => {
      const label = $(dt).text().trim().toLowerCase();
      const dd = $(dt).next('dd');
      if (label.includes('auteur') || label.includes('author')) {
        author = dd.text().trim();
      } else if (label.includes('genre') || label.includes('catégorie')) {
        genre = dd.text().trim();
      } else if (label.includes('statut') || label.includes('status')) {
        const t = dd.text().trim().toLowerCase();
        if (t.includes('terminé') || t.includes('completed')) status = 0;
        else if (t.includes('en cours') || t.includes('ongoing')) status = 1;
      }
    });
    return {
      title, url: mangaUrl, thumbnailUrl, description, author, genre, status, lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('ul.chapters > li:not(.btn)').each((_, el) => {
      const $el = $(el);
      const a = $el.find('.chapter-title-rtl a').first();
      const name = a.text().trim();
      const url = this.absUrl(a.attr('href') || '');
      const dateText = $el.find('.date-chapter-title-rtl').text().trim();
      let dateUpload: number | undefined;
      if (dateText) {
        const d = new Date(dateText);
        if (!isNaN(d.getTime())) dateUpload = d.getTime();
      }
      if (name && url) chapters.push({ name, url, dateUpload });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('#all > img.img-responsive').toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl(
        $(el).attr('data-background-image') ||
        $(el).attr('data-cfsrc') ||
        $(el).attr('data-lazy-src') ||
        $(el).attr('data-src') ||
        $(el).attr('src') || ''
      ),
    })).filter(p => p.imageUrl);
  }
}
