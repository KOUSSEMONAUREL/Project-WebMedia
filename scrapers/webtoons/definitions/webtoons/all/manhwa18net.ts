import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class Manhwa18NetScraper extends BaseScraper {
  readonly name = 'Manhwa18.Net';
  readonly baseUrl = 'https://manhwa18.net';
  readonly lang = 'en';

  async getPopular(page: number): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/manga-list?sort=top&page=${page}`);
    return this.parseList(res.data);
  }

  async getLatest(page: number): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/manga-list?sort=update&page=${page}`);
    return this.parseList(res.data);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const url = query
      ? `${this.baseUrl}/tim-kiem?q=${encodeURIComponent(query)}&page=${page || 1}`
      : `${this.baseUrl}/manga-list?page=${page || 1}`;
    const res = await this.get(url);
    return this.parseList(res.data);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const fullUrl = mangaUrl.startsWith('http') ? mangaUrl : `${this.baseUrl}${mangaUrl}`;
    const res = await this.get(fullUrl);
    const $ = this.$(res.data);
    const appEl = $('#app');
    const dataJson = appEl.attr('data-page');
    if (!dataJson) throw new Error('Could not find data-page attribute');
    const data = JSON.parse(dataJson);
    const props = data.props;
    const manga = props.manga;
    const chapters = props.chapters;
    if (!manga || !chapters) throw new Error('Manga or chapters not found');

    return chapters.map((ch: any) => ({
      name: ch.name,
      url: `/manga/${manga.slug}/${ch.slug}`,
      dateUpload: this.parseDate(ch.created_at),
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const fullUrl = chapterUrl.startsWith('http') ? chapterUrl : `${this.baseUrl}${chapterUrl}`;
    const res = await this.get(fullUrl);
    const $ = this.$(res.data);
    const appEl = $('#app');
    const dataJson = appEl.attr('data-page');
    if (!dataJson) throw new Error('Could not find data-page attribute');
    const data = JSON.parse(dataJson);
    const chapterContent = data.props.chapterContent;
    if (!chapterContent) throw new Error('Chapter content not found');

    const contentHtml = this.$(chapterContent);
    const images = contentHtml('img');

    const pages: Page[] = [];
    images.each((i: number, el: any) => {
      const src = contentHtml(el).attr('src') || contentHtml(el).attr('data-src') || contentHtml(el).attr('data-lazy-src');
      if (src) {
        const fixedUrl = this.fixImageUrl(src);
        if (fixedUrl) {
          pages.push({ index: i, imageUrl: fixedUrl });
        }
      }
    });
    return pages;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const fullUrl = mangaUrl.startsWith('http') ? mangaUrl : `${this.baseUrl}${mangaUrl}`;
    const res = await this.get(fullUrl);
    const $ = this.$(res.data);
    const appEl = $('#app');
    const dataJson = appEl.attr('data-page');
    if (!dataJson) throw new Error('Could not find data-page attribute');
    const data = JSON.parse(dataJson);
    const manga = data.props.manga;
    if (!manga) throw new Error('Manga details not found');

    const description = manga.pilot
      ? this.$(manga.pilot).text()
      : manga.description
        ? this.$(manga.description).text()
        : undefined;

    return {
      title: manga.name,
      thumbnailUrl: this.fixImageUrl(manga.cover_url || manga.thumb_url),
      genre: (manga.genres || []).map((g: any) => g.name).join(', '),
      author: (manga.artists || []).map((a: any) => a.name).join(', ') || undefined,
      url: fullUrl,
      description,
      lang: this.lang,
    };
  }

  private parseList(html: string): SearchResult {
    const $ = this.$(html);
    const appEl = $('#app');
    const dataJson = appEl.attr('data-page');
    if (!dataJson) throw new Error('No manga listing found in response');
    const data = JSON.parse(dataJson);
    const props = data.props;

    const listing = props.paginate || props.popularManga || props.mangas || props.latestManhwaMain;
    if (!listing) throw new Error('No manga listing found in response');

    const mangas: Manga[] = listing.data.map((m: any) => ({
      title: m.name,
      url: `/manga/${m.slug}`,
      thumbnailUrl: this.fixImageUrl(m.cover_url || m.thumb_url) || '',
      lang: this.lang,
    }));

    return { mangas, hasNextPage: listing.next_page_url != null };
  }

  private fixImageUrl(url: string | null): string | undefined {
    if (!url) return undefined;
    if (url.startsWith('http')) return url;
    if (url.startsWith('/')) return this.baseUrl + url;
    return `${this.baseUrl}/${url}`;
  }

  private parseDate(dateStr: string | null): number {
    if (!dateStr) return 0;
    const clean = dateStr.split('.')[0] + 'Z';
    return Date.parse(clean) || 0;
  }
}
