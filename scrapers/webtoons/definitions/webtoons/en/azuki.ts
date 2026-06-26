import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const j = (d: any) => typeof d === 'string' ? JSON.parse(d) : d;

export class AzukiScraper extends BaseScraper {
  readonly name = 'Omoi';
  readonly baseUrl = 'https://www.omoi.com';
  readonly lang = 'en';
  private readonly apiUrl = 'https://production.api.azuki.co';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/discover?sort=popular&page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('ol.o-series-card-list li').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('a.a-card-link').first();
      const gaId = link.attr('data-ga-item-id') || '';
      const uuid = gaId.replace('series-', '');
      const href = link.attr('href') || '';
      const slug = href.split('/').filter(Boolean).pop() || '';
      const title = link.text();
      const thumbnailUrl = this.absUrl($el.find('img').first().attr('src') || '');
      return { title, url: `${slug}#${uuid}`, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/discover?sort=recent_series&page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('ol.o-series-card-list li').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('a.a-card-link').first();
      const gaId = link.attr('data-ga-item-id') || '';
      const uuid = gaId.replace('series-', '');
      const href = link.attr('href') || '';
      const slug = href.split('/').filter(Boolean).pop() || '';
      const title = link.text();
      const thumbnailUrl = this.absUrl($el.find('img').first().attr('src') || '');
      return { title, url: `${slug}#${uuid}`, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/discover?q=${encodeURIComponent(query)}&page=${page}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('ol.o-series-card-list li').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('a.a-card-link').first();
      const gaId = link.attr('data-ga-item-id') || '';
      const uuid = gaId.replace('series-', '');
      const href = link.attr('href') || '';
      const slug = href.split('/').filter(Boolean).pop() || '';
      const title = link.text();
      const thumbnailUrl = this.absUrl($el.find('img').first().attr('src') || '');
      return { title, url: `${slug}#${uuid}`, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('a[rel=next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('#')[0];
    const res = await this.get(`${this.apiUrl}/manga/slug/${slug}/v0`, {
      headers: { Referer: `${this.baseUrl}/`, Origin: this.baseUrl, 'azuki-organization-key': '199e5a19-a236-49f5-81f4-43d4a541748a' },
    });
    const data = j(res.data);
    return {
      title: data?.name || data?.title || "",
      url: mangaUrl,
      thumbnailUrl: this.absUrl(data?.cover || data?.cover_url || data?.thumbnail_url || data?.featuredImage || ""),
      description: (data?.summary || data?.description || "").replace(/<[^>]*>/g, "").trim() || undefined,
      author: data?.author || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const uuid = mangaUrl.split('#')[1];
    const slug = mangaUrl.split('#')[0];
    if (!uuid) return [];
    const res = await this.get(`${this.apiUrl}/mangas/${uuid}/chapters/v4?order=ascending&count=1000`, {
      headers: { Referer: `${this.baseUrl}/`, Origin: this.baseUrl, 'azuki-organization-key': '199e5a19-a236-49f5-81f4-43d4a541748a' },
    });
    const data = j(res.data);
    const chapters = data?.chapters || [];
    return (Array.isArray(chapters) ? chapters : []).map((ch: any) => ({
      name: ch.name || ch.title || `Chapter ${ch.chapter_number || ch.number || ""}`,
      url: `${ch.uuid}#${slug}`,
      chapterNumber: ch.chapter_number || ch.number || undefined,
      dateUpload: ch.created_at || ch.published || ch.date_upload ? new Date(ch.created_at || ch.published || ch.date_upload).getTime() : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterUuid = chapterUrl.split('#')[0];
    const res = await this.get(`${this.apiUrl}/chapters/${chapterUuid}/pages/v1`, {
      headers: { Referer: `${this.baseUrl}/`, Origin: this.baseUrl, 'azuki-organization-key': '199e5a19-a236-49f5-81f4-43d4a541748a' },
    });
    const data = j(res.data);
    const result = data?.data || data;
    const pages = result?.pages || [];
    return (Array.isArray(pages) ? pages : []).map((page: any, index: number) => ({
      index,
      imageUrl: page.image?.webp ? page.image.webp.sort((a: any, b: any) => b.width - a.width)[0]?.url : (typeof page === 'string' ? page : page.url || ''),
    }));
  }
}
