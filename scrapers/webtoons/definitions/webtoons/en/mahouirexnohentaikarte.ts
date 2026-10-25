import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const TITLE = 'Mahoui Rex no Hentai Karte';

export class MahouirexnohentaikarteScraper extends BaseScraper {
  readonly name = 'Mahouirexnohentaikarte';
  readonly baseUrl = 'https://mahouirexnohentaikarte.com';
  readonly lang = 'en';

  private singleManga(): Manga {
    return {
      title: TITLE,
      url: this.baseUrl,
      thumbnailUrl: `${this.baseUrl}/storage/manga/cover.webp`,
      lang: this.lang,
    };
  }

  async getPopular(): Promise<SearchResult> {
    return { mangas: [this.singleManga()], hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const matches = TITLE.toLowerCase().includes(query.trim().toLowerCase());
    return { mangas: matches ? [this.singleManga()] : [], hasNextPage: false };
  }

  private infoValue($: ReturnType<BaseScraper['$']>, label: string): string | undefined {
    const dt = $('dl dt').filter((_i, el) => $(el).text().trim() === label).first();
    const value = dt.next('dd').text().trim();
    return value || undefined;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data as string);
    const title = $('h1').first().text().trim() || TITLE;
    const thumbnail = $('picture img').first().attr('src');
    const statusText = this.infoValue($, 'Status')?.toLowerCase();
    let status: MangaStatus;
    if (statusText === 'on going' || statusText === 'ongoing') status = 1;
    else if (statusText === 'completed') status = 0;
    else if (statusText === 'hiatus') status = 2;
    const alt = $('h1 + p').first().text().trim();
    const synopsis = $('.synopsis').first().text().trim();
    const description = [synopsis, alt ? `Alternative titles: ${alt}` : ''].filter(Boolean).join('\n\n');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : this.singleManga().thumbnailUrl,
      author: this.infoValue($, 'Author'),
      genre: $('h1 ~ ul li').toArray().map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined,
      status,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(): Promise<Chapter[]> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data as string);
    return $('#chapters ol > li > a').toArray().map(el => {
      const link = $(el);
      const name = link.attr('title')?.trim() || link.find('span span').first().text().trim() || link.text().trim();
      const datetime = link.find('time').first().attr('datetime') ?? '';
      const parsed = datetime ? Date.parse(datetime) : NaN;
      return {
        name,
        url: this.absUrl(link.attr('href') ?? ''),
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    return $('img[src*="/storage/manga/chapter-"]').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') ?? ''),
    }));
  }
}

export default MahouirexnohentaikarteScraper;
