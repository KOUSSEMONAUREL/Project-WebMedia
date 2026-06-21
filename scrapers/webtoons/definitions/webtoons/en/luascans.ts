import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class LuascansScraper extends BaseScraper {
  override readonly name = 'Lua Scans';
  override readonly baseUrl = 'https://luacomic.org';
  override readonly lang = 'en';
  private readonly apiUrl = 'https://luacomic.org';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/api/query?page=${page}&perPage=18&searchTerm=${encodeURIComponent(query)}`);
    const data = res.data as { posts: { postTitle: string; slug: string; featuredImage?: string; id: number; isNovel: boolean }[]; totalCount: number };
    const mangas: Manga[] = data.posts.filter(p => !p.isNovel).map(p => ({
      title: p.postTitle,
      url: `${p.slug}#${p.id}`,
      thumbnailUrl: p.featuredImage || '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: data.totalCount > page * 18 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/api/query?page=${page}&perPage=18&searchTerm=&orderBy=totalViews&orderDirection=desc`);
    const data = res.data as { posts: { postTitle: string; slug: string; featuredImage?: string; id: number; isNovel: boolean }[]; totalCount: number };
    const mangas: Manga[] = data.posts.filter(p => !p.isNovel).map(p => ({
      title: p.postTitle,
      url: `${p.slug}#${p.id}`,
      thumbnailUrl: p.featuredImage || '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: data.totalCount > page * 18 };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.apiUrl}/api/query?page=${page}&perPage=18&searchTerm=&orderBy=lastChapterAddedAt&orderDirection=asc`);
    const data = res.data as { posts: { postTitle: string; slug: string; featuredImage?: string; id: number; isNovel: boolean }[]; totalCount: number };
    const mangas: Manga[] = data.posts.filter(p => !p.isNovel).map(p => ({
      title: p.postTitle,
      url: `${p.slug}#${p.id}`,
      thumbnailUrl: p.featuredImage || '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: data.totalCount > page * 18 };
  }

  async getMangaDetails(mangaUrl: string) {
    const slug = mangaUrl.substring(0, mangaUrl.indexOf('#'));
    const res = await this.get(`${this.apiUrl}/api/post?postSlug=${slug}`);
    const data = res.data as { post: { postTitle: string; slug: string; featuredImage?: string; postContent?: string; author?: string; id: number } };
    return {
      title: data.post.postTitle,
      url: `${data.post.slug}#${data.post.id}`,
      thumbnailUrl: data.post.featuredImage || '',
      lang: this.lang,
      author: data.post.author || undefined,
      description: data.post.postContent ? data.post.postContent.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim() : undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.substring(0, mangaUrl.indexOf('#'));
    const res = await this.get(`${this.apiUrl}/api/post?postSlug=${slug}`);
    const data = res.data as { post: { chapters: { id: number; slug: string; number: string; createdAt: string; chapterStatus: string; isAccessible: boolean }[]; slug?: string } };
    return data.post.chapters
      .filter(ch => ch.chapterStatus === 'PUBLIC' && ch.isAccessible)
      .map(ch => ({
        name: `Chapter ${ch.number}${ch.slug ? ` - ${ch.slug.replace(/-/g, ' ')}` : ''}`,
        url: `/series/${data.post.slug || slug}/${ch.slug}#${ch.id}`,
        chapterNumber: parseFloat(ch.number),
        dateUpload: new Date(ch.createdAt).getTime() || undefined,
      }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.substring(chapterUrl.lastIndexOf('#') + 1);
    const res = await this.get(`${this.apiUrl}/api/chapter?chapterId=${id}`);
    const data = res.data as { chapter: { images: { url: string; order?: number }[]; isPermanentlyLocked?: boolean } };
    if (data.chapter.isPermanentlyLocked) throw new Error('Chapter permanently locked');
    return data.chapter.images.map((img, index) => ({
      index,
      imageUrl: img.url.replace(/ /g, '%20'),
    }));
  }
}
