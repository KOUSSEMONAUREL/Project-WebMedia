import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const ONGOING_STATUSES = new Set(['ongoing', 'en marcha', 'em progresso', 'in corso', 'laufend', 'en cours', 'постоянный']);
const COMPLETED_STATUSES = new Set(['completed', 'terminado', 'concluído', 'completato', 'abgeschlossen', 'complété', 'завершенный']);

export class NiaddScraper extends BaseScraper {
  override readonly name = 'Niadd';
  override readonly baseUrl = 'https://www.niadd.com';
  override readonly lang = 'en';

  private jumpUrl: string | null = null;
  private readonly originalChapters = new Set<string>();

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/list/Hot-Manga.html`);
    return this.parseListing(res.data);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/list/New-Update.html`);
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/search/?name=${encodeURIComponent(query)}&page=${page}.html`;
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.manga-item').each((_, el) => {
      const item = $(el);
      const title = item.find('div.manga-name').text().trim();
      const link = item.find('a').first();
      const href = link.attr('href');
      if (!title || !href) return;
      const thumb = item.find('div.manga-img img').first().attr('src') || '';
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb),
        lang: this.lang,
      });
    });
    const hasNextPage = $('a.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const info = $('div.bookside-bookinfo');
    const title = $('h1.book-headline-name').first().text().trim();
    const author = info.find('a[href*=author=]').map((_, el) => $(el).text().trim()).get().filter(Boolean).join(', ');
    const artist = info.find('a[href*=artist=]').map((_, el) => $(el).text().trim()).get().filter(Boolean).join(', ');
    const genre = $('div.bookside-general-cell [itemprop=genre]').map((_, el) => $(el).text().trim()).get().filter(Boolean).join(', ');
    const statusText = $('span.book-status').first().text().trim().replace(/^\(|\)$/g, '').toLowerCase();
    let status: MangaStatus = 3;
    if (ONGOING_STATUSES.has(statusText)) status = 1;
    else if (COMPLETED_STATUSES.has(statusText)) status = 0;
    const description = $('section.detail-synopsis')
      .filter((_, el) => $(el).find('a').length === 0 && $(el).text().trim().length > 0)
      .first()
      .text()
      .trim();
    const thumbnailUrl = $('div.bookside-img img').first().attr('src') || '';
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: author || undefined,
      artist: artist || undefined,
      genre: genre || undefined,
      status,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const chaptersUrl = `${mangaUrl.replace(/\.html$/, '')}/chapters.html`;
    const res = await this.get(chaptersUrl, { headers: { 'User-Agent': 'okhttp/4.12.0' } });
    const $ = this.$(res.data);
    const isOriginal = new URL(mangaUrl).pathname.startsWith('/original/');
    const chapters: Chapter[] = [];
    $('ul.chapter-list a.hover-underline[href*=/chapter/]').each((_, el) => {
      const link = $(el);
      const href = link.attr('href');
      const name = link.find('span.chp-title').text().trim();
      if (!href || !name) return;
      const dateText = link.find('span.chp-time').text().trim();
      const time = Date.parse(dateText);
      const url = this.absUrl(href);
      chapters.push({ name, url, dateUpload: Number.isNaN(time) ? undefined : time });
      if (isOriginal) this.originalChapters.add(url);
    });
    if (chapters.length === 0) {
      chapters.push({ name: 'Chapter', url: mangaUrl });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const segments = new URL(chapterUrl).pathname.split('/').filter(Boolean);
    const chapterId = (segments[2] || '').replace(/\.html$/, '');
    if (!chapterId) throw new Error('Niadd: chapter id not found');
    const reader = new URL(await this.readerJumpUrl());
    reader.searchParams.set('cid', chapterId);
    if (this.originalChapters.has(chapterUrl)) reader.searchParams.set('type', 'ogniadd');
    const html = await this.fetchReaderHtml(reader.toString(), chapterUrl);
    const listMatch = html.match(/all_imgs_url\s*:\s*\[([\s\S]*?)\]/);
    if (!listMatch) throw new Error('Niadd: chapter pages not found');
    const pages: Page[] = [];
    for (const match of listMatch[1].matchAll(/"(https?:\/\/[^"]+)"/g)) {
      pages.push({ index: pages.length, imageUrl: match[1] });
    }
    return pages;
  }

  private async readerJumpUrl(): Promise<string> {
    if (this.jumpUrl) return this.jumpUrl;
    const latest = await this.getLatest(1);
    const first = latest.mangas[0];
    if (!first) throw new Error('Niadd: no manga found for reader');
    const mangaRes = await this.get(first.url);
    const $ = this.$(mangaRes.data);
    const redirectUrl = $('a[href*=/go/rds/]').first().attr('href');
    if (!redirectUrl) throw new Error('Niadd: reader link not found');
    const redirectRes = await this.get(redirectUrl, { headers: { Referer: first.url } });
    const match = String(redirectRes.data).match(/document\.location\s*=\s*'([^']+)'/);
    if (!match) throw new Error('Niadd: reader jump URL not found');
    this.jumpUrl = match[1];
    return this.jumpUrl;
  }

  private async fetchReaderHtml(jumpUrl: string, chapterUrl: string): Promise<string> {
    const first = await this.get(jumpUrl, {
      headers: { Referer: chapterUrl },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    const locationHeader: unknown = first.headers.location;
    const location = typeof locationHeader === 'string' ? locationHeader : undefined;
    if (!location) return String(first.data);
    const rawCookies: unknown = first.headers['set-cookie'];
    const cookieList = Array.isArray(rawCookies)
      ? rawCookies.map(value => String(value))
      : typeof rawCookies === 'string'
        ? [rawCookies]
        : [];
    const cookie = cookieList.map(value => value.split(';')[0]).join('; ');
    const target = new URL(location, jumpUrl).toString();
    const second = await this.get(target, {
      headers: { Referer: chapterUrl, ...(cookie ? { Cookie: cookie } : {}) },
    });
    return String(second.data);
  }
}
