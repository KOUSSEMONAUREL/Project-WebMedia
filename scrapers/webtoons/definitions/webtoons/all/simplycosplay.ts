import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const LIMIT = 20;
const SEARCH_PREFIX = 'url:';
const DEFAULT_TOKEN = '01730876';
const TOKEN_REGEX = /token\s*:\s*"([^"]+)"/;

interface Data<T> { data: T }
interface BrowseItem {
  title?: string;
  slug: string;
  type: string;
  preview: Images;
}
interface TagsResponse { aggs: Agg }
interface Agg { tag_names: TagNames }
interface TagNames { buckets: Array<{ key: string }> }
interface DetailsResponse {
  title?: string;
  slug: string;
  type: string;
  preview: Images;
  tags?: Array<{ name?: string }>;
  image_count?: number;
}
interface PageResponse {
  images?: Images[];
  preview: Images;
}
interface Images {
  publish_date?: string;
  urls: Urls;
}
interface Urls {
  url?: string;
  thumb: { url?: string };
}

const dateFormat = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})/;

function parseDate(s: string | null | undefined): number {
  if (!s) return 0;
  const m = dateFormat.exec(s);
  if (m) return new Date(m[1]).getTime();
  return 0;
}

export class SimplyCosplayScraper extends BaseScraper {
  readonly name = 'Simply Cosplay';
  readonly lang = 'all';
  readonly baseUrl = 'https://www.simply-cosplay.com';
  private readonly apiUrl = 'https://api.simply-porn.com/v2';
  private token = DEFAULT_TOKEN;
  private tagList: string[] = [];
  private tagsFetchAttempt = 0;
  private tagsFetchFailed = false;
  private currentSort = 'hot';
  private browseType = 'gallery';

  private browseUrlBuilder(endPoint: string, sort: string, page: number): string {
    const url = new URL(`${this.apiUrl}/${endPoint}`);
    url.searchParams.set('sort', sort);
    url.searchParams.set('limit', String(LIMIT));
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  private async getWithToken(url: string): Promise<any> {
    const parsed = new URL(url);
    if (parsed.host === new URL(this.apiUrl).host) {
      parsed.searchParams.set('token', this.token);
    }
    const res = await this.get(parsed.toString());
    if (res.status === 403) {
      await this.fetchNewToken();
      const retryUrl = new URL(url);
      if (retryUrl.host === new URL(this.apiUrl).host) {
        retryUrl.searchParams.set('token', this.token);
      }
      return this.get(retryUrl.toString());
    }
    return res;
  }

  private async fetchNewToken(): Promise<void> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const scriptSrc = $('script[src*=main]').first().attr('src') || '';
    if (!scriptSrc) throw new Error('Unable to fetch new Token');
    const scriptUrl = this.absUrl(scriptSrc);
    const scriptRes = await this.get(scriptUrl);
    const content = scriptRes.data.replace(/'/g, '"');
    const match = TOKEN_REGEX.exec(content);
    if (!match || !match[1]) throw new Error('Unable to fetch new Token');
    this.token = match[1];
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      const parsedUrl = new URL(query);
      const allowedHosts = ['simply-cosplay.com', 'www.simply-cosplay.com'];
      if (!allowedHosts.includes(parsedUrl.host)) throw new Error('Unsupported url');
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (segments.length < 3) throw new Error('Unsupported url');
      const newQuery = `${SEARCH_PREFIX}/${segments[0]}/new/${segments[2]}`;
      return this.getSearch(newQuery, page);
    }
    if (query.startsWith(SEARCH_PREFIX)) {
      const url = query.substring(SEARCH_PREFIX.length);
      const details = await this.getMangaDetails(url);
      return { mangas: [{ title: details.title || '', url, thumbnailUrl: details.thumbnailUrl || '', lang: this.lang }], hasNextPage: false };
    }
    return this._search(query, page);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this._browse(this.browseType, 'hot', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this._browse(this.browseType, 'new', page);
  }

  private async _browse(type: string, sort: string, page: number): Promise<SearchResult> {
    await this._fetchTags();
    const url = this.browseUrlBuilder(type, sort, page);
    const res = await this.getWithToken(url);
    const result: Data<BrowseItem[]> = res.data;
    const mangas: Manga[] = result.data.map(item => ({
      title: item.title || '',
      url: `/${item.type.toLowerCase().trim()}/new/${item.slug}`,
      thumbnailUrl: item.preview.urls.thumb.url || '',
      lang: this.lang,
    }));
    const hasNextPage = result.data.length >= LIMIT;
    return { mangas, hasNextPage };
  }

  private async _search(query: string, page: number): Promise<SearchResult> {
    await this._fetchTags();
    const sort = this.currentSort;
    const url = new URL(`${this.apiUrl}/search`);
    url.searchParams.set('sort', sort);
    url.searchParams.set('limit', String(LIMIT));
    url.searchParams.set('page', String(page));
    if (query) url.searchParams.set('query', query);
    const res = await this.getWithToken(url.toString());
    const result: Data<BrowseItem[]> = res.data;
    const mangas: Manga[] = result.data.map(item => ({
      title: item.title || '',
      url: `/${item.type.toLowerCase().trim()}/new/${item.slug}`,
      thumbnailUrl: item.preview.urls.thumb.url || '',
      lang: this.lang,
    }));
    const hasNextPage = result.data.length >= LIMIT;
    return { mangas, hasNextPage };
  }

  private async _fetchTags(): Promise<void> {
    if (this.tagsFetchAttempt >= 3 && !this.tagsFetchFailed) return;
    if (this.tagList.length > 0 && !this.tagsFetchFailed) return;
    try {
      const url = `${this.apiUrl}/search`;
      const res = await this.get(url);
      const result: TagsResponse = res.data;
      this.tagList = result.aggs.tag_names.buckets.map(b => b.key.trim());
      this.tagsFetchFailed = false;
    } catch (err) {
      console.error(`Failed to fetch tags: ${err instanceof Error ? err.message : err}`);
      this.tagsFetchFailed = true;
    }
    this.tagsFetchAttempt++;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const apiUrl = this._mangaApiUrl(mangaUrl);
    const res = await this.getWithToken(apiUrl);
    const result: Data<DetailsResponse> = res.data;
    const d = result.data;
    const title = d.title || '';
    const thumbnailUrl = d.preview.urls.thumb.url || '';
    const genre = d.tags?.map(t =>
      t.name?.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    ).filter(Boolean).join(', ') || undefined;
    const description = `Type: ${d.type}\n` +
      (d.image_count != null ? `Images: ${d.image_count}\n` : '') +
      (d.preview.publish_date ? `Date: ${d.preview.publish_date}\n` : '');
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, description, genre };
  }

  private _mangaApiUrl(dbUrl: string): string {
    const segments = dbUrl.split('/').filter(Boolean);
    const type = segments[0];
    const slug = segments[2];
    return `${this.apiUrl}/${type}/${slug}`;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const segments = mangaUrl.split('/').filter(Boolean);
    const chapterName = segments.length >= 1
      ? segments[0].charAt(0).toUpperCase() + segments[0].slice(1)
      : '';
    const details = await this.getMangaDetails(mangaUrl);
    const dateUpload = details.description
      ? parseDate(/Date: (.+)$/m.exec(details.description)?.[1])
      : undefined;
    return [{ name: chapterName, url: mangaUrl, dateUpload }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const apiUrl = this._mangaApiUrl(chapterUrl);
    const res = await this.getWithToken(apiUrl);
    const result: Data<PageResponse> = res.data;
    const images = result.data.images;
    if (images && images.length > 0) {
      return images.map((img, index) => ({
        index,
        imageUrl: img.urls.url || '',
      })).filter(p => p.imageUrl !== '');
    }
    return [{ index: 0, imageUrl: result.data.preview.urls.url || '' }];
  }
}
