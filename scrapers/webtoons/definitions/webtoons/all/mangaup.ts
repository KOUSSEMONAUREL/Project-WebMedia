import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const PREFIX_ID_SEARCH = 'id:';
const ID_SEARCH_PATTERN = /^id:(\d+)$/;

export class MangaUpScraper extends BaseScraper {
  readonly name = 'Manga UP!';
  readonly baseUrl = 'https://global.manga-up.com';
  readonly lang = 'all';

  private readonly apiUrl = 'https://global-api.manga-up.com/api';
  private readonly imgUrl = 'https://global-img.manga-up.com';

  async getPopular(page: number): Promise<SearchResult> {
    const url = `${this.apiUrl}/search?app_ver=0&os_ver=0&lang=en`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const mangas: Manga[] = (result.titles || []).map((item: any) => this.toSManga(item));
    return { mangas, hasNextPage: false };
  }

  async getLatest(page: number): Promise<SearchResult> {
    const url = `${this.apiUrl}/home_v2?app_ver=0&os_ver=0&lang=en`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const list = result.type === 'Updates for you' ? result.updates : result.newSeries;
    const mangas: Manga[] = (list || []).map((item: any) => this.toSManga(item));
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      try {
        const urlObj = new URL(query);
        if (urlObj.hostname !== new URL(this.baseUrl).hostname && urlObj.hostname !== `www.${new URL(this.baseUrl).hostname}`) {
          throw new Error('Unsupported url');
        }
        const id = urlObj.pathname.split('/')[1];
        return this.getSearch(`${PREFIX_ID_SEARCH}${id}`, page);
      } catch (err) {
        console.error(`Failed to parse URL ${query} on ${this.name}: ${err instanceof Error ? err.message : err}`);
        throw new Error('Unsupported url');
      }
    }

    if (query.startsWith(PREFIX_ID_SEARCH) && ID_SEARCH_PATTERN.test(query)) {
      const mangaId = query.replace(PREFIX_ID_SEARCH, '');
      const url = `${this.apiUrl}/manga/detail_v2?app_ver=0&os_ver=0&title_id=${mangaId}&quality=high&ui_lang=en`;
      const data = await this.get(url);
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      const manga = this.toSMangaDetail(result, mangaId);
      return { mangas: [manga], hasNextPage: false };
    }

    const url = `${this.apiUrl}/manga/search?app_ver=0&os_ver=0&lang=en&word=${encodeURIComponent(query)}`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const mangas: Manga[] = (result.titles || []).map((item: any) => this.toSManga(item));
    return { mangas, hasNextPage: false };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const titleId = mangaUrl.split('/').pop() || '';
    const url = `${this.apiUrl}/manga/detail_v2?app_ver=0&os_ver=0&title_id=${titleId}&quality=high&ui_lang=en`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return (result.chapters || []).map((ch: any) => this.toSChapter(ch, titleId));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('/').pop() || '';
    const url = `${this.apiUrl}/manga/viewer_v2?app_ver=0&os_ver=0&chapter_id=${chapterId}&quality=high&lang=en`;
    const data = await this.post(url, {});
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const pages = (result.pageBlocks || []).flatMap((block: any) => block.pages || [])
      .filter((p: any) => !p.url.includes('tutorial'));

    if (pages.length === 0) {
      throw new Error('Log in via WebView and purchase this chapter');
    }

    return pages.map((page: any, i: number) => ({
      index: i,
      url: `${this.imgUrl}${page.url}#key=${page.key}#iv=${page.iv}`,
    }));
  }

  private toSManga(item: any): Manga {
    return {
      url: `/manga/${item.id}`,
      title: item.name,
      thumbnail_url: this.imgUrl + item.thumbnail,
    };
  }

  private toSMangaDetail(result: any, mangaId: string): Manga {
    const descParts: string[] = [];
    if (result.description) descParts.push(result.description);
    if (result.copyright) descParts.push(result.copyright);
    if (result.schedule) descParts.push(result.schedule);
    if (result.warning) descParts.push(result.warning);

    return {
      url: `/manga/${mangaId}`,
      title: result.title,
      author: result.author,
      description: descParts.join('\n\n'),
      genre: (result.tags || []).map((t: any) => t.name).join(', '),
      thumbnail_url: this.imgUrl + result.thumbnail,
      status: (result.chapters || []).some((ch: any) => ch.status === 1) ? 2 : 1,
    };
  }

  private toSChapter(ch: any, mangaId: string): Chapter {
    const subtitle = ch.subtitle ? ` - ${ch.subtitle}` : '';
    let title = `${ch.name}${subtitle}`;
    if (ch.status === 1) {
      title += ' [Final]';
    }
    return {
      url: `/manga/${mangaId}/${ch.id}`,
      name: ch.price != null ? `🔒 ${title}` : title,
      date_upload: this.parseDate(ch.dateStr),
    };
  }

  private parseDate(dateStr: string): number {
    if (!dateStr) return 0;
    return Date.parse(dateStr);
  }
}
