import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface MayoChapterDto {
  id: string;
  title: string;
  number: number;
  pageCount: number;
  date: string;
}

export class MayoTuneScraper extends BaseScraper {
  readonly name = 'Mayonaka Heart Tune';
  readonly baseUrl = 'https://mayochuu.xyz';
  readonly lang = 'all';

  private readonly chapterEndpoint = '';
  private readonly sourceTitle = 'Mayonaka Heart Tune';
  private readonly sourceAuthor = 'Masakuni Igarashi';

  private buildSource(): Manga {
    return {
      title: this.sourceTitle,
      url: '/',
      thumbnailUrl: `${this.baseUrl}/img/cover.jpg`,
      lang: this.lang,
      author: this.sourceAuthor,
    };
  }

  async getPopular(): Promise<SearchResult> {
    return { mangas: [this.buildSource()], hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    return { mangas: [this.buildSource()], hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const q = query.toLowerCase();
    const names = ['tune in to the midnight heart', '真夜中ハートチューン', 'mayonaka heart tune'];
    if (names.some(n => n.includes(q)) || this.sourceAuthor.toLowerCase().includes(q)) {
      return { mangas: [this.buildSource()], hasNextPage: false };
    }
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(_mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(`${this.baseUrl}/`);
    const $ = this.$(response.data);
    const statusText = $("div.text-center:contains('Status')").first().text().split('Status')[0].trim();
    let status: Manga['status'];
    if (statusText === 'Ongoing') status = 1;
    else if (statusText === 'Completed' || statusText === 'Finished') status = 0;
    else if (statusText === 'Cancelled') status = 2;
    else if (statusText === 'Hiatus') status = 3;
    const thumbnail = $('img.object-contain').first().attr('src') || '';
    return {
      title: this.sourceTitle,
      author: this.sourceAuthor,
      description: $('.text-lg').first().text().trim() || undefined,
      genre: $('span.text-sm:nth-child(2)').first().text().replace('•', ',') || undefined,
      status,
      thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : `${this.baseUrl}/img/cover.jpg`,
    };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(`${this.baseUrl}/api/${this.chapterEndpoint}/chapters`);
    const chapters = response.data as MayoChapterDto[];
    return [...chapters]
      .sort((a, b) => b.number - a.number)
      .map(ch => {
        const numStr = Number.isInteger(ch.number) ? ch.number.toFixed(0) : String(ch.number);
        const ts = Date.parse(ch.date);
        return {
          url: `/api/${this.chapterEndpoint}/chapters?id=${ch.id}&number=${numStr}`,
          name: ch.title && ch.title.trim() ? `Chapter ${numStr}: ${ch.title}` : `Chapter ${numStr}`,
          chapterNumber: ch.number,
          dateUpload: Number.isNaN(ts) ? 0 : ts,
        };
      });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const dto = response.data as MayoChapterDto;
    return Array.from({ length: dto.pageCount }, (_, i) => ({
      index: i,
      imageUrl: `${this.baseUrl}/api/manga/${dto.id}/${i + 1}`,
    }));
  }
}
