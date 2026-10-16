import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class OmegaScansScraper extends BaseScraper {
  readonly name = 'Omega Scans';
  readonly baseUrl = 'https://omegascans.org';
  readonly lang = 'en';

  private extractSeries(html: string): Manga[] {
    const $ = this.$(html);
    const seen = new Set<string>();
    const mangas: Manga[] = [];
    ($('a[href*="/series/"]').toArray() as any[]).forEach(el => {
      const href = ($(el).attr('href') as string) || '';
      const m = href.match(/\/series\/([^\/?#]+)/);
      if (!m) return;
      const slug = m[1];
      const url = this.absUrl(`/series/${slug}`);
      if (seen.has(url)) return;
      seen.add(url);
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const thumb = ($(el).find('img').attr('src') as string) || ($(el).find('img').attr('data-src') as string) || '';
      mangas.push({ title, url, thumbnailUrl: this.absUrl(thumb), lang: this.lang });
    });
    return mangas;
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    return { mangas: this.extractSeries(res.data as string), hasNextPage: false };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return this.getPopular(_page);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const normalized = query.toLowerCase();
    const mangas = this.extractSeries(res.data as string)
      .filter(m => m.title.toLowerCase().includes(normalized) || m.url.toLowerCase().includes(normalized.replace(/\s+/g, '-')));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return { url: mangaUrl, lang: this.lang };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    return [];
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    return [];
  }
}
