import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const PAGE_SIZE = 48;
const FLAG = 'us';

export class QtoonUnoriginalScraper extends BaseScraper {
  override readonly name = 'Qtoon (unoriginal)';
  override readonly baseUrl = 'https://qtoon.org';
  override readonly lang = 'en';

  private readonly listingPages = new Map<string, number>();

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getListing(this.browseUrl('popular'), page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getListing(this.browseUrl('latest'), page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.browseUrl('latest'));
    if (query.trim() !== '') {
      url.searchParams.set('q', query.trim());
    }
    return this.getListing(url.toString(), page);
  }

  private browseUrl(sort: string): string {
    const url = new URL(`${this.baseUrl}/browse`);
    url.searchParams.set('sort', sort);
    return url.toString();
  }

  private async getListing(url: string, page: number): Promise<SearchResult> {
    if (page === 1) {
      this.listingPages.clear();
    }
    const key = `${url} ${page}`;
    let sitePage = this.listingPages.get(key) ?? page;

    while (true) {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('page', sitePage.toString());
      const response = await this.get(pageUrl.toString());
      const $ = this.$(response.data);
      const cards = $('#genre-media-flow .manga-item');
      const mangas: Manga[] = [];

      cards.each((_, el) => {
        const card = $(el);
        if (card.find(`.cover-lang-flags .fi-${FLAG}`).length === 0) return;
        const link = card.find('a').first();
        mangas.push({
          title: card.find('.mangaName').first().text(),
          url: this.absUrl(link.attr('href') || ''),
          thumbnailUrl: this.absUrl(card.find('img').first().attr('src') || ''),
          lang: this.lang,
        });
      });

      const hasNextPage = cards.length >= PAGE_SIZE;
      sitePage += 1;
      if (mangas.length > 0 || !hasNextPage) {
        this.listingPages.set(`${url} ${page + 1}`, sitePage);
        return { mangas, hasNextPage };
      }
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.getSeriesPage(mangaUrl);
    const $ = this.$(response.data);
    const canonical = $('link[rel=canonical]').first().attr('href');
    const status = $('.detail-meta-chip.chip-ongoing').length > 0
      ? 1
      : $('.detail-meta-chip.chip-done').length > 0
        ? 0
        : 3;

    return {
      title: $('h1.title').first().text(),
      url: canonical ? this.absUrl(canonical) : this.absUrl(mangaUrl),
      thumbnailUrl: this.absUrl($('img.image').first().attr('src') || ''),
      lang: this.lang,
      author: $('a.detail-author-link').map((_, el) => $(el).text()).get().join(', ') || undefined,
      genre: $('.detail-meta-chip[class*=detail-meta-chip--], ul.tag a')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((value, index, values) => value !== '' && values.indexOf(value) === index)
        .join(', ') || undefined,
      status,
      description: $('#syn-clamp').first().text().trim() || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.getSeriesPage(mangaUrl);
    const $ = this.$(response.data);
    const chapters: Chapter[] = [];

    $('#episode-list > li[data-ep-num]').each((_, el) => {
      const row = $(el);
      let link = row.find(`.ch-langs a[data-lang="${this.lang}"]`).first();
      if (link.length === 0) {
        link = row.find('.ch-langs a').first();
      }
      if (link.length === 0) return;

      const number = Number(row.attr('data-ep-num'));
      const date = row.find('p.time').first().text().trim();
      chapters.push({
        name: row.find('h3.name').first().text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        chapterNumber: Number.isFinite(number) ? number : undefined,
        dateUpload: date ? Date.parse(date) : undefined,
      });
    });

    if (chapters.length === 0) {
      chapters.push({ name: 'Chapter', url: this.absUrl(mangaUrl) });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    return $('#rdr-panels img[data-src]').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('data-src') || ''),
    }));
  }

  private async getSeriesPage(mangaUrl: string) {
    const url = new URL(this.absUrl(mangaUrl));
    url.searchParams.set('lang', this.lang);
    return this.get(url.toString());
  }
}
