import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MantaScraper extends BaseScraper {
  readonly name = 'Manta';
  readonly baseUrl = 'https://manta.net/en';
  readonly lang = 'en';

  private readonly apiUrl = 'https://manta.net';

  async getPopular(page: number): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getLatest(page: number): Promise<SearchResult> {
    return this.getSearch('', page);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const url = `${this.apiUrl}/manta/v1/search/series?lang=en${query ? `&q=${encodeURIComponent(query)}` : '&tagId=288'}`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const mangas: Manga[] = (result.data || []).map((item: any) => ({
      title: this.seriesString(item, 'en'),
      url: item.id.toString(),
      thumbnail_url: item.image?.toString() || '',
    }));
    return { mangas, hasNextPage: false };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = `${this.apiUrl}/front/v1/series/${mangaUrl}?lang=en`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const episodes = result.data?.data?.episodes || result.data?.episodes || [];
    return episodes
      .filter((ep: any) => !(ep.lockData && this.isLocked(ep.lockData)))
      .map((ep: any) => ({
        name: this.episodeString(ep, 'en'),
        url: ep.id.toString(),
        date_upload: this.episodeTimestamp(ep),
        chapter_number: ep.ord,
      }))
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = `${this.apiUrl}/front/v1/episodes/${chapterUrl}?lang=en`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const cutImages = result.data?.cutImages;
    if (!cutImages) return [];
    return cutImages.map((img: any, idx: number) => ({
      index: idx,
      url: img.toString(),
    }));
  }

  async getMangaDetail(mangaUrl: string): Promise<Manga> {
    const data = await this.get(`${this.apiUrl}/front/v1/series/${mangaUrl}?lang=en`);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const seriesData = result.data?.data;
    if (!seriesData) throw new Error('Manga details not found');

    const artists = (seriesData.creators || [])
      .filter((c: any) => c.role === 'Illustration')
      .map((c: any) => c.toString());
    const authors = (seriesData.creators || [])
      .filter((c: any) => c.role !== 'Illustration')
      .map((c: any) => c.toString());
    if (authors.length === 0 && seriesData.creators) {
      authors.push(...seriesData.creators.map((c: any) => c.toString()));
    }

    return {
      title: result.data.asString?.('en') || '',
      url: mangaUrl,
      description: this.descriptionString(seriesData.description, 'en'),
      genre: (seriesData.tags || []).map((t: any) => this.tagString(t, 'en')).join(', '),
      artist: artists.join(', '),
      author: authors.join(', '),
      status: seriesData.isCompleted ? 2 : 1,
    };
  }

  private seriesString(series: any, lang: string): string {
    if (series.asString) return series.asString(lang);
    if (series.data?.title) {
      if (series.data.title.asString) return series.data.title.asString(lang);
      if (series.data.title.title) {
        return series.data.title.title[lang] || series.data.title.title.en || '';
      }
    }
    return series.title || '';
  }

  private episodeString(ep: any, lang: string): string {
    if (ep.asString) return ep.asString(lang);
    const epTitle = ep.data?.title;
    if (epTitle) return epTitle;
    const prefix = lang === 'es' ? 'Episodio' : 'Episode';
    let name = `${prefix} ${ep.ord}`;
    if (ep.lockData && this.isLocked(ep.lockData)) name += ' 🔒';
    return name;
  }

  private episodeTimestamp(ep: any): number {
    const parse = (s: string) => {
      if (!s) return 0;
      const clean = s.split('.')[0].split('+')[0].split('Z')[0];
      return Date.parse(clean) || 0;
    };
    return parse(ep.openAt) || parse(ep.createdAt);
  }

  private descriptionString(desc: any, lang: string): string {
    if (!desc) return '';
    if (desc.asString) return desc.asString(lang);
    const parts = [desc.short, desc.long].filter(Boolean);
    return parts.join('\n\n');
  }

  private tagString(tag: any, lang: string): string {
    if (tag.asString) return tag.asString(lang);
    if (tag.name) {
      if (tag.name.asString) return tag.name.asString(lang);
      return tag.name[lang] || tag.name.en || '';
    }
    return tag.toString();
  }

  private isLocked(lockData: any): boolean {
    if (!lockData) return false;
    const state = lockData.state ?? lockData.state_;
    return state != null && ![110, 130].includes(state);
  }
}
