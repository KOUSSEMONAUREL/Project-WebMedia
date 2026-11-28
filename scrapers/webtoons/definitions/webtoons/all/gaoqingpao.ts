import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_PATH = '/wp-json/wp/v2';
const IMAGE_BASE_URL = 'https://img.gaoqingpao.com/';
const PAGE_SIZE = 30;
const POST_PATH = /^\/g(\d+)\.html\/?$/;

interface RenderedDto {
  rendered: string;
}

interface PostDto {
  id: number;
  title: RenderedDto;
  content: RenderedDto;
  date_gmt?: string | null;
  _embedded?: {
    'wp:term'?: TermDto[][];
  };
}

interface PostContentDto {
  content: RenderedDto;
}

interface TermDto {
  id: number;
  name: string;
  slug: string;
}

export class GaoqingpaoScraper extends BaseScraper {
  readonly name = 'Gaoqingpao';
  readonly baseUrl = 'https://www.gaoqingpao.com';
  readonly lang = 'all';

  private decode(html: string): string {
    const $ = this.$(html);
    return $('body').text();
  }

  private imageUrls(html: string): string[] {
    const $ = this.$(html);
    return $('img[src]').toArray()
      .map(el => ($(el).attr('src') || '').trim())
      .filter(Boolean)
      .map(src => new URL(src, IMAGE_BASE_URL).toString());
  }

  private toManga(dto: PostDto): Manga {
    const genres = (dto._embedded?.['wp:term'] ?? [])
      .flat()
      .map(term => term.name)
      .filter(Boolean);
    return {
      title: this.decode(dto.title.rendered),
      url: `${this.baseUrl}/g${dto.id}.html`,
      thumbnailUrl: this.imageUrls(dto.content.rendered)[0] ?? '',
      genre: genres.join(', ') || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  private async getPosts(page: number, extra: Record<string, string> = {}): Promise<SearchResult> {
    const params = new URLSearchParams({
      page: page.toString(),
      per_page: PAGE_SIZE.toString(),
      _fields: 'id,title,content',
      ...extra,
    });
    const res = await this.get(`${API_PATH}/posts?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const posts = res.data as PostDto[];
    const totalPages = parseInt(String(res.headers['x-wp-totalpages'] ?? '1'), 10) || 1;
    return {
      mangas: posts.map(post => this.toManga(post)),
      hasNextPage: posts.length === PAGE_SIZE && page < totalPages,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getPosts(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const q = query.trim();
    if (!q) return this.getPosts(page);
    return this.getPosts(page, { search: q, search_columns: 'post_title' });
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.postId(mangaUrl);
    if (!id) return {};
    const params = new URLSearchParams({
      _embed: 'wp:term',
      _fields: 'id,title,content,date_gmt,_links.wp:term,_embedded',
    });
    const res = await this.get(`${API_PATH}/posts/${id}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    return this.toManga(res.data as PostDto);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.postId(mangaUrl);
    if (!id) return [];
    return [{ name: 'Gallery', url: `${this.baseUrl}/g${id}.html` }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = this.postId(chapterUrl);
    if (!id) return [];
    const res = await this.get(`${API_PATH}/posts/${id}?_fields=content`, {
      headers: { Accept: 'application/json' },
    });
    const dto = res.data as PostContentDto;
    return this.imageUrls(dto.content.rendered).map((imageUrl, index) => ({ index, imageUrl }));
  }

  private postId(url: string): string | null {
    try {
      return POST_PATH.exec(new URL(url, this.baseUrl).pathname)?.[1] ?? null;
    } catch {
      return null;
    }
  }
}
