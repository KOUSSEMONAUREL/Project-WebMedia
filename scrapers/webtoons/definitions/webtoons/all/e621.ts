import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface Pool {
  id: number;
  name: string;
  description?: string | null;
  post_ids: number[];
  is_active?: boolean | null;
  updated_at: string;
}

interface Post {
  id: number;
  flags: { deleted: boolean };
  files: {
    meta: { ext: string };
    original: { url: string | null };
    preview: { webp: string | null };
    sample: { webp: string | null };
  };
  tags: Record<string, string[]>;
}

interface PostsResponse {
  posts: Post[];
}

const PAGE_SIZE = 24;
const POST_BATCH = 200;
const VIDEO_EXTENSIONS = new Set(['webm', 'mp4']);
const DELETED_PLACEHOLDER =
  'https://placehold.co/256x256/cccccc/f66151.jpg?text=Post%20Deleted';

export class E621Scraper extends BaseScraper {
  readonly name = 'e621';
  readonly baseUrl = 'https://e621.net';
  readonly lang = 'all';

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': 'E621/1.0 (Project-WebMedia)',
    };
  }

  private apiUrl(path: string, params: Record<string, string>): string {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async pools(params: Record<string, string>): Promise<Pool[]> {
    const res = await this.get(
      this.apiUrl('/pools.json', params),
      { headers: this.headers() },
    );
    return res.data as Pool[];
  }

  private async pool(id: number): Promise<Pool> {
    const res = await this.get(
      this.apiUrl(`/pools/${id}.json`, {}),
      { headers: this.headers() },
    );
    return res.data as Pool;
  }

  private async posts(ids: number[]): Promise<Post[]> {
    const result: Post[] = [];
    for (let i = 0; i < ids.length; i += POST_BATCH) {
      const chunk = ids.slice(i, i + POST_BATCH);
      const res = await this.get(
        this.apiUrl('/posts.json', {
          tags: `status:all id:${chunk.join(',')}`,
          limit: String(chunk.length),
          mode: 'extended',
        }),
        { headers: this.headers() },
      );
      const data = res.data as PostsResponse;
      result.push(...(data.posts ?? []));
    }
    const byId = new Map(result.map(post => [post.id, post]));
    return ids.map(id => byId.get(id)).filter((post): post is Post => !!post);
  }

  private imageUrl(post: Post): string {
    if (post.flags.deleted) return DELETED_PLACEHOLDER;
    if (VIDEO_EXTENSIONS.has(post.files.meta.ext)) {
      return post.files.sample.webp || post.files.preview.webp || DELETED_PLACEHOLDER;
    }
    return (
      post.files.original.url ||
      post.files.sample.webp ||
      post.files.preview.webp ||
      DELETED_PLACEHOLDER
    );
  }

  private poolUrl(id: number): string {
    return `${this.baseUrl}/pools/${id}`;
  }

  private mangaFromPool(pool: Pool, firstPost?: Post): Manga {
    return {
      title: pool.name.replace(/_/g, ' '),
      url: this.poolUrl(pool.id),
      thumbnailUrl: firstPost?.files.preview.webp || '',
      lang: this.lang,
      description: pool.description || undefined,
      status: pool.is_active === true ? 1 : pool.is_active === false ? 0 : undefined,
    };
  }

  private async poolList(
    params: Record<string, string>,
  ): Promise<SearchResult> {
    const pools = (await this.pools(params))
      .filter(pool => pool.post_ids.length > 0);
    const firstIds = pools.map(pool => pool.post_ids[0]);
    const posts = await this.posts(firstIds);
    const postMap = new Map(posts.map(post => [post.id, post]));

    return {
      mangas: pools.map(pool =>
        this.mangaFromPool(pool, postMap.get(pool.post_ids[0]))),
      hasNextPage: pools.length >= PAGE_SIZE,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.poolList({
      page: String(page),
      'search[order]': 'post_count',
      limit: String(PAGE_SIZE),
    });
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.poolList({
      page: String(page),
      'search[order]': 'updated_at',
      limit: String(PAGE_SIZE),
    });
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (/^https?:\/\//.test(query)) {
      const parsed = new URL(query);
      if (!parsed.hostname.endsWith('e621.net')) {
        throw new Error('Unsupported url');
      }
      const id = Number(parsed.pathname.match(/\/pools\/(\d+)/)?.[1]);
      if (!id) throw new Error('Unsupported url');
      const details = await this.getMangaDetails(this.poolUrl(id));
      return {
        mangas: [{
          title: details.title || `Pool #${id}`,
          url: this.poolUrl(id),
          thumbnailUrl: details.thumbnailUrl || '',
          lang: this.lang,
          description: details.description,
        }],
        hasNextPage: false,
      };
    }

    return this.poolList({
      page: String(page),
      'search[order]': 'updated_at',
      'search[name_matches]': `*${query.trim().replace(/\s+/g, '_')}*`,
      limit: String(PAGE_SIZE),
    });
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.poolId(mangaUrl);
    const pool = await this.pool(id);
    const firstPost = pool.post_ids[0]
      ? (await this.posts([pool.post_ids[0]]))[0]
      : undefined;
    return this.mangaFromPool(pool, firstPost);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.poolId(mangaUrl);
    const pool = await this.pool(id);
    return [{
      name: `Pool #${id} (${pool.post_ids.length} pages)`,
      url: this.poolUrl(id),
      chapterNumber: 1,
      dateUpload: Date.parse(pool.updated_at) || undefined,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = this.poolId(chapterUrl);
    const pool = await this.pool(id);
    const posts = await this.posts(pool.post_ids);
    const postMap = new Map(posts.map(post => [post.id, post]));

    return pool.post_ids.map((postId, index) => {
      const post = postMap.get(postId);
      return {
        index,
        imageUrl: post ? this.imageUrl(post) : DELETED_PLACEHOLDER,
      };
    });
  }

  private poolId(url: string): number {
    const match = url.match(/\/pools\/(\d+)/);
    if (!match) throw new Error('Unsupported url');
    return Number(match[1]);
  }
}
