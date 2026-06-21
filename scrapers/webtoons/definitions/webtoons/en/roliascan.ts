import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class RoliascanScraper extends BaseScraper {
  override readonly name = 'Rolia Scan';
  override readonly baseUrl = 'https://roliascan.com';
  override readonly lang = 'en';

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/api/comic?page=1&perPage=24${query ? `&keyword=${encodeURIComponent(query)}` : ''}`);
    const data = res.data as { data: { list: { id: string; name: string; cover: string; type?: string }[] } };
    const mangas: Manga[] = (data.data?.list || []).filter((m: any) => m.type !== 'Novel').map(m => ({
      title: m.name,
      url: `/comic/${m.id}`,
      thumbnailUrl: m.cover || '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    return this.getSearch('', _page);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return this.getSearch('', _page);
  }

  async getMangaDetails(mangaUrl: string) {
    const id = mangaUrl.replace('/comic/', '');
    const res = await this.get(`${this.baseUrl}/api/comic/detail?id=${id}`);
    const data = res.data as { data: { name: string; cover: string; description?: string; author?: string } };
    return {
      title: data.data.name,
      url: mangaUrl,
      thumbnailUrl: data.data.cover || '',
      lang: this.lang,
      author: data.data.author || undefined,
      description: data.data.description || undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.replace('/comic/', '');
    const res = await this.get(`${this.baseUrl}/api/comic/chapter?comicId=${id}`);
    const data = res.data as { data: { list: { id: string; name: string; ordering: string; created_at: string }[] } };
    return (data.data?.list || []).map(ch => ({
      name: ch.name,
      url: `/chapter/${ch.id}`,
      chapterNumber: parseFloat(ch.ordering),
      dateUpload: new Date(ch.created_at).getTime() || undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.replace('/chapter/', '');
    const res = await this.get(`${this.baseUrl}/api/comic/content?chapterId=${id}`);
    const data = res.data as { data: { images: string[] } };
    return (data.data?.images || []).map((imgUrl, index) => ({
      index,
      imageUrl: imgUrl,
    }));
  }
}
