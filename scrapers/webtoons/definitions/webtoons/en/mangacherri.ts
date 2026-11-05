import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

function parseStatus(status: string | null | undefined): MangaStatus {
  const text = status?.toLowerCase() ?? '';
  if (text.includes('ongoing')) return 1;
  if (text.includes('completed')) return 0;
  if (text.includes('hiatus')) return 3;
  if (text.includes('cancelled') || text.includes('canceled')) return 2;
  return 3;
}

export class MangaCherriScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor() {
    super();
    this.name = 'MangaCherri';
    this.baseUrl = 'https://mangacherri.com';
    this.lang = 'en';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.browse(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(page, 'updated');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.browse(page, 'popular', query);
  }

  private async browse(page: number, sort: string, query?: string): Promise<SearchResult> {
    const params = new URLSearchParams({ sort });
    if (query) params.set('q', query);
    if (page > 1) params.set('page', String(page));
    const res = await this.get(`${this.baseUrl}/manga?${params.toString()}`);
    const $ = this.$(String(res.data));
    const mangas = $('article.cherri-list-card').toArray().map(el => {
      const card = $(el);
      const link = card.find('h2 a').first();
      return {
        title: link.text().trim(),
        url: this.absUrl(link.attr('href') ?? ''),
        thumbnailUrl: this.absUrl(card.find('img').first().attr('src') ?? ''),
        lang: this.lang,
        genre: card.find('.cherri-detail__chips a').toArray()
          .map(chip => $(chip).text().trim())
          .filter(Boolean)
          .join(', ') || undefined,
        status: parseStatus(card.find('small.eyebrow').first().text()),
      } satisfies Manga;
    });
    const hasNextPage = $('nav.pager a').toArray()
      .some(el => $(el).text().toLowerCase().includes('next'));
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const details = $('.cherri-detail').first();
    if (details.length === 0) return {};
    const copy = details.find('.cherri-detail__copy');
    const title = details.find('h1').first().text().trim();
    const alt = copy.find('.cherri-detail__alt').first().text().trim()
      .split(';')
      .map(value => value.trim())
      .filter(value => value && value !== title);
    const description = details.find('.cherri-detail__description').first().text().trim();
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(details.find('.cherri-detail__cover img').first().attr('src') ?? ''),
      lang: this.lang,
      author: copy.find('> p > strong').first().text().trim() || undefined,
      status: parseStatus(copy.find('> p.eyebrow').first().text()),
      genre: details.find('.cherri-detail__chips a').toArray()
        .map(chip => $(chip).text().trim())
        .filter(Boolean)
        .join(', ') || undefined,
      description: [
        description,
        alt.length > 0 ? `Alternative titles: ${alt.join(', ')}` : '',
      ].filter(Boolean).join('\n\n') || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    return $('[data-chapter-list] a[data-chapter-row]').toArray().map(el => {
      const row = $(el);
      const name = row.find('strong').first().text().trim();
      const match = /Chapter\s+([\d.]+)/i.exec(name);
      const date = row.find('time').attr('datetime');
      return {
        name,
        url: this.absUrl(row.attr('href') ?? ''),
        chapterNumber: match ? Number.parseFloat(match[1]) : undefined,
        dateUpload: date ? new Date(date).getTime() || undefined : undefined,
      } satisfies Chapter;
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    return $('[data-cherri-reader] img[data-page]').toArray()
      .map((el, index) => ({
        index,
        imageUrl: this.absUrl($(el).attr('src') ?? ''),
      }));
  }
}
