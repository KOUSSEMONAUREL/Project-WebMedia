import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const PREFIX_ID_SEARCH = 'id:';
const PREFIX_FAK_ID_SEARCH = 'fakku:';
const PREFIX_EHEN_ID_SEARCH = 'ehentai:';
const PREFIX_SOURCE_SEARCH = 'source:';

export class PandaChaikaScraper extends BaseScraper {
  readonly name = 'PandaChaika';
  readonly baseUrl = 'https://panda.chaika.moe';
  readonly lang = 'all';
  private readonly searchLang = '';

  private readonly baseSearchUrl = `${this.baseUrl}/search`;

  async getPopular(page: number): Promise<SearchResult> {
    const html = await this.get(`${this.baseSearchUrl}/?tags=${this.searchLang}&sort=rating&apply=&json=&page=${page}`);
    return this.searchMangaParse(html);
  }

  async getLatest(page: number): Promise<SearchResult> {
    const html = await this.get(`${this.baseSearchUrl}/?tags=${this.searchLang}&sort=public_date&apply=&json=&page=${page}`);
    return this.searchMangaParse(html);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const pageNum = page || 1;

    if (query.startsWith('https://')) {
      try {
        const urlObj = new URL(query);
        if (urlObj.hostname !== new URL(this.baseUrl).hostname) throw new Error('Unsupported url');
        if (urlObj.pathname.split('/').filter(Boolean).length <= 2) throw new Error('Unsupported url');
        const segments = urlObj.pathname.split('/').filter(Boolean);
        const id = `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
        return this.getSearch(`${PREFIX_ID_SEARCH}${id}`, page);
      } catch (err) {
        console.error(`Failed to parse URL ${query} on ${this.name}: ${err instanceof Error ? err.message : err}`);
        throw new Error('Unsupported url');
      }
    }

    if (query.startsWith(PREFIX_SOURCE_SEARCH)) {
      const srcUrl = query.replace(PREFIX_SOURCE_SEARCH, '');
      const html = await this.get(`${this.baseSearchUrl}/?qsearch=${encodeURIComponent(srcUrl)}&json=`);
      const result = typeof html === 'string' ? JSON.parse(html) : html;
      const archive = result.archives?.[0];
      if (!archive) throw new Error('Not Found');
      return { mangas: [this.toSManga(archive)], hasNextPage: false };
    }

    if (query.startsWith(PREFIX_EHEN_ID_SEARCH) || query.startsWith(PREFIX_FAK_ID_SEARCH)) {
      let baseLink: string;
      let id: string;
      if (query.startsWith(PREFIX_EHEN_ID_SEARCH)) {
        id = query.replace(PREFIX_EHEN_ID_SEARCH, '').replace(/https?:\/\/e-hentai\.org\/g\//, '');
        baseLink = 'https://e-hentai.org/g/';
      } else {
        id = query.replace(PREFIX_FAK_ID_SEARCH, '').replace(/https?:\/\/(?:www\.)?fakku\.net\/hentai\//, '');
        baseLink = 'https://www.fakku.net/hentai/';
      }
      const html = await this.get(`${this.baseSearchUrl}/?qsearch=${encodeURIComponent(baseLink + id)}&json=`);
      const result = typeof html === 'string' ? JSON.parse(html) : html;
      const archive = result.archives?.[0];
      if (!archive) throw new Error('Not Found');
      return { mangas: [this.toSManga(archive)], hasNextPage: false };
    }

    if (query.startsWith(PREFIX_ID_SEARCH)) {
      const id = parseInt(query.replace(PREFIX_ID_SEARCH, ''));
      const data = await this.get(`${this.baseUrl}/api?archive=${id}`);
      const archive = typeof data === 'string' ? JSON.parse(data) : data;
      const title = archive.title;
      const html = await this.get(`${this.baseSearchUrl}/?qsearch=${encodeURIComponent(title)}&json=`);
      const result = typeof html === 'string' ? JSON.parse(html) : html;
      const found = result.archives?.find((a: any) => a.id === id);
      if (!found) throw new Error('Invalid ID');
      return { mangas: [this.toSManga(found)], hasNextPage: false };
    }

    const url = this.buildSearchUrl(query, pageNum);
    const html = await this.get(url);
    return this.searchMangaParse(html);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const data = await this.get(`${this.baseUrl}/api?archive=${mangaUrl}`);
    const archive = typeof data === 'string' ? JSON.parse(data) : data;
    return [{
      name: 'Chapter',
      url: archive.download.split('/download/')[0],
      dateUpload: archive.posted * 1000,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    throw new Error('Page list is handled via ZIP streaming, not supported in this transpilation');
  }

  async getMangaDetail(mangaUrl: string): Promise<Manga> {
    const data = await this.get(`${this.baseUrl}/api?archive=${mangaUrl}`);
    const archive = typeof data === 'string' ? JSON.parse(data) : data;
    return this.toSManga(archive);
  }

  private async searchMangaParse(response: any): Promise<SearchResult> {
    const result = response.data;
    const mangas = result.archives.map((a: any) => this.toSManga(a));
    return { mangas, hasNextPage: result.has_next ?? false };
  }

  private toSManga(archive: any): Manga {
    const tags: string[] = archive.tags || [];

    const filterTags = (include: string, exclude: string[] = []): string | undefined => {
      const filtered = tags
        .filter((t: string) => t.startsWith(`${include}:`) && !exclude.some((ex) => t.startsWith(`${ex}:`)))
        .map((t: string) => t.split(':').slice(1).join(':').replace(/_/g, ' ')
          .split(' ').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' '));
      return filtered.length ? filtered.join(', ') : undefined;
    };

    const groups = filterTags('group');
    const artists = filterTags('artist');
    const publishers = filterTags('publisher');
    const characters = filterTags('character');
    const male = filterTags('male');
    const female = filterTags('female');
    const others = filterTags('', ['female', 'male', 'artist', 'publisher', 'group', 'parody']);
    const parodies = filterTags('parody');

    const description = [
      `Uploader: ${archive.uploader || 'Anonymous'}`,
      publishers ? `Publishers: ${publishers}` : '',
      '',
      parodies ? `Parodies: ${parodies}` : '',
      characters ? `Characters: ${characters}` : '',
      (parodies || characters) ? '' : '',
      male ? `Male tags: ${male}` : '',
      female ? `Female tags: ${female}` : '',
      others ? `Other tags: ${others}` : '',
      archive.title_jpn ? `Japanese Title: ${archive.title_jpn}` : '',
      `Pages: ${archive.filecount}`,
      `File Size: ${this.getReadableSize(archive.filesize)}`,
      archive.public_date ? `Public Date: ${new Date(archive.public_date * 1000).toDateString()}` : '',
      archive.posted ? `Posted: ${new Date(archive.posted * 1000).toDateString()}` : '',
    ].filter(Boolean).join('\n');

    return {
      url: archive.id.toString(),
      title: archive.title,
      thumbnailUrl: archive.thumbnail,
      lang: this.lang,
      author: groups || artists,
      artist: artists,
      genre: [male, female, others].filter(Boolean).join(', '),
      description,
      status: 2,
    };
  }

  private buildSearchUrl(query: string, page: number): string {
    const url = new URL(this.baseSearchUrl);
    url.searchParams.set('title', query);
    url.searchParams.set('tags', this.searchLang);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('apply', '');
    url.searchParams.set('json', '');
    return url.toString();
  }

  private getReadableSize(bytes: number): string {
    if (bytes >= 300 * 1000 * 1000) return `${(bytes / (1000 * 1000 * 1000)).toFixed(2)} GB`;
    if (bytes >= 100 * 1000) return `${(bytes / (1000 * 1000)).toFixed(2)} MB`;
    if (bytes >= 1000) return `${(bytes / 1000).toFixed(2)} kB`;
    return `${bytes} B`;
  }
}
