import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const HEROINES = 'heroines-hentai';
const THEMES = 'porno-hentai';
const SHORTCODE_REGEX = /\[\w+[^\]]*]/g;
const SIZE_REGEX = /-\d+x\d+(?=\.\w+$)/;

interface CategoryDto {
  id?: number;
  count?: number;
  name?: string;
  description?: string;
  _embedded?: { up?: { name?: string }[] };
}

interface PostDto {
  date_gmt?: string;
  featured_media?: number;
}

interface MediaDto {
  source_url?: string;
}

export class MangaplexeScraper extends BaseScraper {
  readonly name = 'Mangaplexe';
  readonly baseUrl = 'https://www.mangaplexe.com';
  readonly lang = 'fr';

  // The site stopped publishing in July 2022
  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    return { mangas: await this.getEntries(false), hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    return { mangas: await this.getEntries(false, query.trim()), hasNextPage: false };
  }

  // The site publishes single images, filed by heroine (under her series) or by theme: each of these is an entry
  private async getEntries(themes: boolean, query = ''): Promise<Manga[]> {
    const res = await this.get(`/${themes ? THEMES : HEROINES}/`);
    const $ = this.$(res.data as string);
    // The themes page also links a lone image outside of any category
    return $('figure.wp-caption:has(a[href*=/category/])').toArray().map(el => {
      const figure = $(el);
      const link = figure.find('a').first();
      const caption = figure.find('figcaption').first();
      const title = caption.find('b').first().text().trim() || caption.text().trim();
      const url = this.absUrl(link.attr('href') || '');
      const thumbnailUrl = this.absUrl((figure.find('img').first().attr('src') || '').replace(SIZE_REGEX, ''));
      return { title, url, thumbnailUrl, lang: this.lang };
    }).filter(manga => {
      if (!manga.title || !manga.url) return false;
      return !query || manga.title.toLowerCase().includes(query.toLowerCase());
    });
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const category = await this.fetchCategory(mangaUrl);
    const page = await this.get(mangaUrl);
    const $ = this.$(page.data as string);
    const genre = category._embedded?.up?.[0]?.name?.replace(/ Hentai$/, '') ?? '';
    const description = String(category.description ?? '').replace(SHORTCODE_REGEX, '');
    const title = ($('h1.page-header-title').first().text().trim() || category.name || '').replace(/ Hentai$/, '');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: $('meta[property="og:image"]').attr('content') || undefined,
      genre: genre || undefined,
      description: [
        typeof category.count === 'number' ? `Images: ${category.count}` : '',
        this.$(description).text().replace(/\s+/g, ' ').trim(),
      ].filter(Boolean).join('\n\n') || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const category = await this.fetchCategory(mangaUrl);
    if (typeof category.id !== 'number') return [];
    const posts = await this.fetchPosts(category.id);
    if (posts.length === 0) return [];
    const lastDate = posts[posts.length - 1].date_gmt;
    const dateUpload = lastDate ? Date.parse(`${lastDate}Z`) : NaN;
    return [{
      name: 'Images',
      url: mangaUrl,
      dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const category = await this.fetchCategory(chapterUrl);
    if (typeof category.id !== 'number') return [];
    const posts = await this.fetchPosts(category.id);
    const mediaIds = posts
      .map(post => post.featured_media)
      .filter((id): id is number => typeof id === 'number');
    if (mediaIds.length === 0) return [];
    const media = await this.fetchMedia(mediaIds);
    return media
      .map(item => item.source_url ?? '')
      .filter(url => url.length > 0)
      .map((imageUrl, index) => ({ index, imageUrl }));
  }

  private async fetchCategory(mangaUrl: string): Promise<CategoryDto> {
    const slug = mangaUrl.split('?')[0].split('/').filter(Boolean).pop() ?? '';
    if (!slug) return {};
    const res = await this.get(this.api('categories', { slug, _embed: 'up' }));
    const list = res.data as CategoryDto[];
    return list[0] ?? {};
  }

  private async fetchPosts(categoryId: number): Promise<PostDto[]> {
    const res = await this.get(this.api('posts', {
      categories: String(categoryId),
      order: 'asc',
      per_page: '100',
      _fields: 'date_gmt,featured_media',
    }));
    return res.data as PostDto[];
  }

  private async fetchMedia(ids: number[]): Promise<MediaDto[]> {
    const res = await this.get(this.api('media', {
      include: ids.join(','),
      orderby: 'include',
      per_page: '100',
      _fields: 'source_url',
    }));
    return res.data as MediaDto[];
  }

  private api(path: string, params: Record<string, string>): string {
    const query = new URLSearchParams(params);
    return `${this.baseUrl}/wp-json/wp/v2/${path}?${query.toString()}`;
  }
}

export default MangaplexeScraper;
