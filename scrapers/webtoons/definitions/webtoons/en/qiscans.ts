import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class QiscansScraper extends BaseScraper {
  override readonly name = 'Qi Scans';
  override readonly baseUrl = 'https://qimanga.com';
  override readonly lang = 'en';
  private readonly apiUrl = 'https://api.qimanga.com/api/v1';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const endpoint = query ? `${this.apiUrl}/series/search` : `${this.apiUrl}/series`;
    const params = new URLSearchParams({ page: String(page), perPage: '20' });
    if (query) params.set('q', query);
    else params.set('sort', 'latest');
    const res = await this.get(`${endpoint}?${params.toString()}`, {
      headers: { Origin: this.baseUrl, 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site' },
    });
    const data = res.data as { posts?: { postTitle: string; slug: string; featuredImage?: string }[]; totalCount?: number };
    const mangas: Manga[] = (data.posts || []).map(p => ({
      title: p.postTitle,
      url: `/series/${p.slug}`,
      thumbnailUrl: p.featuredImage || '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: (data.totalCount || 0) > page * 20 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace('/series/', '');
    const res = await this.get(`${this.apiUrl}/series/${slug}/chapters`, {
      headers: { Origin: this.baseUrl },
    });
    const data = res.data as { chapters?: { id: number; slug: string; number: string; createdAt: string; title?: string }[] };
    return (data.chapters || []).map(ch => ({
      name: `Chapter ${ch.number}${ch.title ? ` - ${ch.title}` : ''}`,
      url: `/series/${slug}/chapters/${ch.slug}`,
      chapterNumber: parseFloat(ch.number),
      dateUpload: new Date(ch.createdAt).getTime() || undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const path = chapterUrl.replace('/series/', '');
    const res = await this.get(`${this.apiUrl}/series/${path}`, {
      headers: { Origin: this.baseUrl },
    });
    const data = res.data as { chapter?: { images: { url: string; order?: number }[] } };
    const images = data.chapter?.images || [];
    return images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((img, index) => ({
      index,
      imageUrl: img.url,
    }));
  }
}
