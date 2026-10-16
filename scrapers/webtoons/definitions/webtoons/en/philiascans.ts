import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class PhiliaScansScraper extends BaseScraper {
  readonly name = 'Philia Scans';
  readonly baseUrl = 'https://philiascans.org';
  readonly lang = 'en';

  private extractSeries(html: string): Manga[] {
    const seen = new Set<string>();
    const mangas: Manga[] = [];
    const re = /\/series\/([a-z0-9-]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const slug = match[1];
      const url = this.absUrl(`/series/${slug}`);
      if (seen.has(url)) continue;
      seen.add(url);
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      mangas.push({ title, url, thumbnailUrl: '', lang: this.lang });
    }
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
