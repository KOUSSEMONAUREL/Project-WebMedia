import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const RELATIVE_DATE = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;

export class KaliscansorgScraper extends BaseScraper {
  readonly name = 'KaliScansOrg';
  readonly baseUrl = 'https://kaliscans.org';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.parseListing((await this.get(`/popular?page=${page}`)).data as string);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.parseListing((await this.get(`/latest?page=${page}`)).data as string);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('status', 'all');
    url.searchParams.set('sort', 'updated_at');
    url.searchParams.set('page', String(page));
    return this.parseListing((await this.get(url.toString())).data as string);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.book-item').each((_, el) => {
      const link = $(el).find('h3 a[href]').first();
      const href = link.attr('href') || '';
      const url = this.absUrl(href);
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      const slug = segments[1];
      if (!slug) return;
      mangas.push({
        title: link.text().trim(),
        url,
        thumbnailUrl: this.absUrl($(el).find('.thumb img[data-src]').attr('data-src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('.paginator a.active ~ a.btn').length > 0 };
  }

  private slugFromUrl(mangaUrl: string): string {
    const value = mangaUrl.trim();
    if (!value) return '';
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const segments = new URL(value).pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || '';
    }
    if (value.startsWith('/')) {
      const segments = value.split('/').filter(Boolean);
      return segments[segments.length - 1] || '';
    }
    return value.split('/').filter(Boolean).pop() || '';
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFromUrl(mangaUrl);
    if (!slug) throw new Error(`Invalid manga url: ${mangaUrl}`);
    const res = await this.get(`/series/${slug}`);
    const $ = this.$(res.data as string);
    const status = ($('.meta.box p:has(strong:contains(Status)) span').first().text() || '')
      .trim()
      .toLowerCase();
    const genres = $('.meta.box p:has(strong:contains(Genres)) a')
      .map((_, el) => $(el).text().replace(/,\s*$/, '').trim())
      .get();
    const alt = $('.name.box h2').first().text().trim();
    const rating =
      ($('script[type="application/ld+json"]')
        .map((_, el) => $(el).html() || '')
        .get()
        .find(data => data.includes('AggregateRating')) || '')
        .match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/)?.[1];
    const views = $('.meta.box p:has(strong:contains(Views)) span').first().text().trim();
    const summary = $('.summary .content')
      .map((_, el) => $(el).html() || '')
      .get()
      .join('\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const parts: string[] = [];
    const facts = [rating ? `Rating: ${rating}` : '', views ? `Views: ${views}` : ''].filter(Boolean);
    if (facts.length) parts.push(facts.join(' · '));
    if (summary) parts.push(summary);
    if (alt) {
      const alts = alt
        .split(';')
        .map(t => t.trim())
        .filter(t => t && t.toLowerCase() !== $('.name.box h1').first().text().trim().toLowerCase());
      if (alts.length) parts.push(`Alternative Titles: ${alts.join(' · ')}`);
    }
    return {
      title: $('.name.box h1').first().text().trim() || slug,
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('#cover img[data-src]').attr('data-src') || ''),
      author: $('.meta.box p:has(strong:contains(Authors)) span').first().text().trim() || undefined,
      genre: genres.length ? genres.join(', ') : undefined,
      status:
        status === 'ongoing' || status === 'publishing'
          ? 1
          : status === 'completed'
            ? 0
            : status === 'hiatus'
              ? 3
              : undefined,
      description: parts.join('\n\n') || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    if (!slug) return [];
    const res = await this.get(`/series/${slug}`);
    const $ = this.$(res.data as string);
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    $('#chapter-list li a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const url = this.absUrl(href);
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      const sub = segments[2];
      if (!sub) return;
      if (seen.has(url)) return;
      seen.add(url);
      chapters.push({
        name: $(el).find('.chapter-title').first().text().trim(),
        url,
        chapterNumber: parseFloat(sub.replace('-', '.')) || undefined,
        dateUpload: this.parseRelativeDate($(el).find('.chapter-update').first().text().trim()),
      });
    });
    return chapters.sort(
      (a, b) =>
        parseFloat((b.url.split('/').pop() || '0').replace('-', '.')) -
        parseFloat((a.url.split('/').pop() || '0').replace('-', '.')),
    );
  }

  private parseRelativeDate(text: string): number | undefined {
    const match = text.match(RELATIVE_DATE);
    if (!match) return undefined;
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const now = new Date();
    if (unit === 'second') now.setSeconds(now.getSeconds() - amount);
    else if (unit === 'minute') now.setMinutes(now.getMinutes() - amount);
    else if (unit === 'hour') now.setHours(now.getHours() - amount);
    else if (unit === 'day') now.setDate(now.getDate() - amount);
    else if (unit === 'week') now.setDate(now.getDate() - amount * 7);
    else if (unit === 'month') now.setMonth(now.getMonth() - amount);
    else now.setFullYear(now.getFullYear() - amount);
    return now.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = /^https?:\/\//.test(chapterUrl)
      ? chapterUrl
      : `${this.baseUrl}/series/${chapterUrl}`;
    const res = await this.get(url);
    const $ = this.$(res.data as string);
    return $('#chapter-images img')
      .map((i, el) => ({
        imageUrl: this.absUrl($(el).attr('src') || ''),
        index: i,
      }))
      .get()
      .filter(p => !!p.imageUrl);
  }
}

export default KaliscansorgScraper;
