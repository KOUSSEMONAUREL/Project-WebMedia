import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface CreditEntry {
  label: string;
  value: string;
}

function parseStatus(value: string | undefined): MangaStatus {
  switch (value?.trim().toLowerCase()) {
    case 'completed':
      return 0;
    case 'ongoing':
      return 1;
    case 'canceled':
    case 'cancelled':
    case 'dropped':
      return 2;
    case 'on hold':
    case 'hiatus':
      return 3;
    default:
      return undefined;
  }
}

function parseChapterDate(value: string): number | undefined {
  const absolute = Date.parse(value);
  if (!Number.isNaN(absolute)) return absolute;

  const relative = /(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i.exec(value);
  if (!relative) return undefined;
  const amount = Number.parseInt(relative[1], 10);
  const unit = relative[2].toLowerCase();
  const date = new Date();
  switch (unit) {
    case 'minute':
      date.setMinutes(date.getMinutes() - amount);
      break;
    case 'hour':
      date.setHours(date.getHours() - amount);
      break;
    case 'day':
      date.setDate(date.getDate() - amount);
      break;
    case 'week':
      date.setDate(date.getDate() - amount * 7);
      break;
    case 'month':
      date.setMonth(date.getMonth() - amount);
      break;
    case 'year':
      date.setFullYear(date.getFullYear() - amount);
      break;
    default:
      return undefined;
  }
  return date.getTime();
}

export class AquamangaScraper extends BaseScraper {
  readonly name = 'Aqua Manga';
  readonly baseUrl = 'https://aquareader.org';
  readonly lang = 'en';

  private listingUrl(page: number, params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    const path = page > 1 ? `/manga/page/${page}/` : '/manga/';
    return query ? `${path}?${query}` : path;
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('article.aqua-archive-card').each((_, element) => {
      const card = $(element);
      const link = card.find('.aqua-archive-card__title a').first();
      const href = (link.attr('href') ?? '').trim();
      const title = link.text().trim();
      if (!href || !title) return;
      const image = card.find('img').first();
      const thumbnail = (image.attr('data-src') ?? image.attr('src') ?? '').trim();
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : '',
        lang: this.lang,
      });
    });
    return {
      mangas,
      hasNextPage: $('a.next.page-numbers, a.next').length > 0,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listingUrl(page, { m_orderby: 'views' }));
    return this.parseListing(String(res.data));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listingUrl(page, { m_orderby: 'latest' }));
    return this.parseListing(String(res.data));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params: Record<string, string> = { m_orderby: 'views' };
    if (query.trim()) params.search = query.trim();
    const res = await this.get(this.listingUrl(page, params));
    return this.parseListing(String(res.data));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const title = $('.aqua-series-info__title').first().text().trim();
    const thumbnail = ($('.aqua-series-cover__img').first().attr('src') ?? '').trim();
    const synopsis = $('.aqua-series-synopsis').first().text().trim();
    const status = parseStatus($('.aqua-series-meta__status').first().text());
    const genres = $('.aqua-series-genre-pill')
      .toArray()
      .map(element => $(element).text().trim())
      .filter(Boolean);

    const credits: CreditEntry[] = [];
    $('.aqua-series-info__creator').each((_, element) => {
      const entry = $(element);
      const label = entry.find('.aqua-series-info__creator-label').first().text().trim();
      const value = entry
        .find('.aqua-series-info__creator-value a')
        .toArray()
        .map(link => $(link).text().trim())
        .filter(Boolean)
        .join(', ');
      if (value) credits.push({ label, value });
    });
    const authorNames = [...new Set(credits.map(entry => entry.value))].join(', ');
    const alternateNames = $('.aqua-alt-pill').first().text().trim();

    const descriptionParts: string[] = [];
    if (synopsis) descriptionParts.push(synopsis);
    if (alternateNames) descriptionParts.push(`Alternative Names: ${alternateNames}`);

    return {
      title: title || undefined,
      url: mangaUrl,
      thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : undefined,
      description: descriptionParts.join('\n\n') || undefined,
      author: authorNames || undefined,
      genre: [...new Set(genres)].join(', ') || undefined,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const chapters: Chapter[] = [];
    $('.aqua-ch-item').each((_, element) => {
      const chapter = $(element);
      const href = (chapter.attr('href') ?? '').trim();
      const name = chapter.find('.aqua-ch-item__name').first().text().trim();
      if (!href || !name) return;
      const dateText = chapter.find('.aqua-ch-item__time').first().text().trim();
      const number = /(\d+(?:\.\d+)?)/.exec(name);
      chapters.push({
        name,
        url: this.absUrl(href),
        chapterNumber: number ? Number.parseFloat(number[1]) : undefined,
        dateUpload: dateText ? parseChapterDate(dateText) : undefined,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    const pages: Page[] = [];
    $('.reading-content img, div.page-break img').each((_, element) => {
      const image = $(element);
      const source = (image.attr('data-src') ?? image.attr('src') ?? '').trim();
      if (!source) return;
      pages.push({ index: pages.length, imageUrl: this.absUrl(source) });
    });
    return pages;
  }
}

export default AquamangaScraper;
