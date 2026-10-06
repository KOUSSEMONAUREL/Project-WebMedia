import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_PATH = '/api/v1';
const PAGE_CREATORS_LIMIT = 50;
const PAGE_POST_LIMIT = 50;
const POST_PAGES_DEFAULT = 1;
const PROMPT = 'You can change how many posts to load in the extension preferences.';
const IMAGE_EXTS = new Set(['png', 'jpg', 'gif', 'jpeg', 'webp']);

interface CreatorDto {
  id: string;
  name: string;
  service: string;
  updated: string | number;
  favorited?: number;
}

interface FileDto {
  path?: string;
}

interface PostDto {
  id: string;
  service: string;
  user: string;
  title: string;
  added?: string | null;
  published?: string | null;
  edited?: string | null;
  file?: FileDto | null;
  attachments?: FileDto[];
}

function serviceName(service: string): string {
  if (service === 'fanbox') return 'Pixiv Fanbox';
  return service.charAt(0).toUpperCase() + service.slice(1);
}

export class PawchiveScraper extends BaseScraper {
  readonly name = 'Pawchive';
  readonly baseUrl = 'https://pawchive.pw';
  readonly lang = 'all';

  private get imgUrl(): string {
    return this.baseUrl.replace('//', '//img.');
  }

  private async fetchCreators(): Promise<CreatorDto[]> {
    const res = await this.get(`${API_PATH}/creators`, { headers: { Accept: 'text/css' } });
    return res.data as CreatorDto[];
  }

  private toManga(creator: CreatorDto): Manga {
    return {
      title: creator.name,
      url: `/${creator.service}/user/${creator.id}`,
      thumbnailUrl: `${this.baseUrl}/icons/${creator.service}/${creator.id}`,
      author: serviceName(creator.service),
      description: PROMPT,
      lang: this.lang,
    };
  }

  private updatedMs(updated: string | number): number {
    if (typeof updated === 'string') {
      const ms = Date.parse(updated);
      return Number.isNaN(ms) ? 0 : ms;
    }
    return updated * 1000;
  }

  private paginate(sorted: CreatorDto[], page: number): SearchResult {
    const start = (page - 1) * PAGE_CREATORS_LIMIT;
    const items = sorted.slice(start, start + PAGE_CREATORS_LIMIT);
    return { mangas: items.map((c) => this.toManga(c)), hasNextPage: start + PAGE_CREATORS_LIMIT < sorted.length };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const creators = await this.fetchCreators();
    const sorted = [...creators].sort((a, b) => (b.favorited ?? -1) - (a.favorited ?? -1));
    return this.paginate(sorted, page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const creators = await this.fetchCreators();
    const sorted = [...creators].sort((a, b) => this.updatedMs(b.updated) - this.updatedMs(a.updated));
    return this.paginate(sorted, page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const creators = await this.fetchCreators();
    const q = query.trim().toLowerCase();
    const filtered = creators.filter((c) => c.name.toLowerCase().includes(q));
    const sorted = filtered.sort((a, b) => (b.favorited ?? -1) - (a.favorited ?? -1));
    return this.paginate(sorted, page);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const match = /^\/([^/]+)\/user\/([^/]+)/.exec(mangaUrl);
    if (!match) return { url: mangaUrl };
    const creators = await this.fetchCreators();
    const creator = creators.find((c) => c.id === match[2]);
    if (!creator) return { url: mangaUrl };
    return this.toManga(creator);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const maxPosts = POST_PAGES_DEFAULT * PAGE_POST_LIMIT;
    const result: Chapter[] = [];
    let offset = 0;
    let hasNextPage = true;
    while (offset < maxPosts && hasNextPage) {
      const res = await this.get(`${API_PATH}${mangaUrl}/posts?o=${offset}`, { headers: { Accept: 'text/css' } });
      const page = res.data as PostDto[];
      for (const post of page) {
        if (this.imagesOf(post).length === 0) continue;
        const dateStr = post.published ?? post.added ?? post.edited;
        const title = post.title.trim();
        const name = title || `Post from ${dateStr ? dateStr.split('+')[0].split('Z')[0].replace('T', ' at ') : 'unknown date'}`;
        const chapter: Chapter = { name, url: `/${post.service}/user/${post.user}/post/${post.id}` };
        const ms = this.parsePostDate(dateStr, post.service);
        if (ms !== undefined) chapter.dateUpload = ms;
        result.push(chapter);
      }
      offset += PAGE_POST_LIMIT;
      hasNextPage = page.length === PAGE_POST_LIMIT;
    }
    // Every post is its own chapter, so it needs a unique chapter number.
    // Posts arrive newest-first, so the newest gets the highest number.
    result.forEach((chapter, index) => {
      chapter.chapterNumber = result.length - index;
    });
    return result;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${API_PATH}${chapterUrl}`, { headers: { Accept: 'text/css' } });
    const post = res.data as PostDto;
    // The full-size file host (file.pawchive.pw) answers 404 from datacenter
    // egress (verified by probe); the thumbnail host answers 200. This mirrors
    // the upstream FALLBACK_LOW_RES_IMG path, which our axios engine cannot do
    // per-image via an OkHttp interceptor.
    return this.imagesOf(post).map((path, i) => ({
      index: i,
      imageUrl: `${this.imgUrl}/thumbnail/data${path}`,
    }));
  }

  private imagesOf(post: PostDto): string[] {
    const files: FileDto[] = [post.file ?? {}, ...(post.attachments ?? [])];
    const seen = new Set<string>();
    const images: string[] = [];
    for (const file of files) {
      const path = file.path ?? '';
      if (!path) continue;
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      if (!IMAGE_EXTS.has(ext)) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      images.push(path);
    }
    return images;
  }

  private parsePostDate(raw: string | null | undefined, service: string): number | undefined {
    if (!raw) return undefined;
    const withTz = raw.endsWith('Z') || raw.includes('+') ? raw : raw + (service === 'fanbox' ? '+09:00' : 'Z');
    const ms = Date.parse(withTz);
    return Number.isNaN(ms) ? undefined : ms;
  }
}
