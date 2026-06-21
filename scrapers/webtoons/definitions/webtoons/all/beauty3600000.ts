import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface PostDto {
  id: number;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  date: string;
}

interface TermDto {
  id: number;
  name: string;
  slug: string;
}

const API_BASE = 'wp-json/wp/v2';
const PER_PAGE = 100;
const jsonArrayRegex = /\[.*]\s*$/;

function decodeHtmlEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

export class Beauty3600000Scraper extends BaseScraper {
  readonly name = '3600000 Beauty';
  readonly baseUrl = 'https://3600000.xyz';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/${API_BASE}/posts`);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('per_page', PER_PAGE.toString());
    const response = await this.get(url.toString());
    const body = typeof response === 'string' ? response : response.data;
    const match = body.match(jsonArrayRegex);
    if (!match) return { mangas: [], hasNextPage: false };
    const posts: PostDto[] = JSON.parse(match[0]);
    const mangas: Manga[] = posts.map((p: PostDto) => ({
      url: p.id.toString(),
      title: decodeHtmlEntities(p.title.rendered),
      thumbnailUrl: p.content.rendered.match(/<img[^>]+src="([^">]+)"/)?.[1] || '',
      lang: this.lang,
    }));
    const totalPages = parseInt(response.headers?.get?.('X-WP-TotalPages') || '0', 10);
    const currentPage = page;
    return { mangas, hasNextPage: currentPage < totalPages };
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    return this.getPopular(page || 1);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl;
    const url = new URL(`${this.baseUrl}/${API_BASE}/posts`);
    if (/^\d+$/.test(id)) {
      url.pathname += `/${id}`;
    } else {
      url.searchParams.set('slug', id.replace(/^\/|\/$/g, ''));
    }
    const response = await this.get(url.toString());
    const data = response.data;
    const post = Array.isArray(data) ? data[0] : data;
    return [{
      url: id,
      name: 'Gallery',
      dateUpload: post?.date ? new Date(post.date).getTime() : 0,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(`${this.baseUrl}/${API_BASE}/posts/${chapterUrl}`);
    const response = await this.get(url.toString());
    const post: PostDto = response.data;
    const $ = this.$(post.content.rendered);
    const pages: Page[] = [];
    $('img').each((i: number, el: any) => {
      pages.push({ index: i, imageUrl: $(el).attr('src') });
    });
    return pages;
  }
}
