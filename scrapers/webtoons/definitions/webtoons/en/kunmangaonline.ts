import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';
import type { Chapter, Manga, SearchResult } from '../../../engine/types';

interface KunChapterDto {
  chapter_name: string;
  chapter_slug: string;
  updated_at?: string | null;
}

interface KunChapterListResponse {
  data: {
    chapters: KunChapterDto[];
    last_page: number;
  };
}

export class KunmangaonlineScraper extends MadaraScraper {
  constructor() { super('KunManga', 'https://www.kunmanga.online', 'en'); }

  protected override imageFromElement(el: ReturnType<CheerioAPI>): string | null {
    const host = this.baseUrl.replace(/^https?:\/\//, '');
    const candidates = ['data-backup', 'src', 'data-src', 'data-lazy-src', 'data-aload']
      .map(name => el.attr(name)?.trim())
      .filter((v): v is string => !!v)
      .map(v => this.absUrl(v));
    return candidates.find(u => u.startsWith('http') && !u.includes(`${host}/thumb/`)) ?? null;
  }

  private archiveUrl(page: number, order: string): string {
    const path = page > 1 ? `/manga/page/${page}/` : '/manga/';
    const params = order ? `?m_orderby=${encodeURIComponent(order)}` : '';
    return `${this.baseUrl}${path}${params}`;
  }

  private parseArchive(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.c-tabs-item__content, .page-item-detail').toArray()
      .map(el => this.archiveManga($(el)))
      .filter((m): m is Manga => m !== null);
    const hasNextPage = $('a[aria-label=Next]').length > 0;
    return { mangas, hasNextPage };
  }

  private archiveManga($el: ReturnType<CheerioAPI>): Manga | null {
    const link = $el.find('.post-title a, h3.h4 a').first();
    const href = link.length > 0 ? link.attr('href') || '' : '';
    if (!href) return null;
    const img = $el.find('img').first();
    const thumb = img.length > 0 ? this.imageFromElement(img) : null;
    return {
      title: link.text().trim(),
      url: this.absUrl(href),
      thumbnailUrl: thumb || '',
      lang: this.lang,
    };
  }

  public override async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.archiveUrl(page, 'views'));
    return this.parseArchive(res.data);
  }

  public override async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.archiveUrl(page, 'latest'));
    return this.parseArchive(res.data);
  }

  public override async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query) {
      const res = await this.get(this.archiveUrl(page, ''));
      return this.parseArchive(res.data);
    }
    const url = page > 1
      ? `${this.baseUrl}/page/${page}/?s=${encodeURIComponent(query)}&post_type=wp-manga`
      : `${this.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
    const res = await this.get(url);
    return this.parseArchive(res.data);
  }

  private mangaSlug(mangaUrl: string): string {
    const path = mangaUrl.replace(this.baseUrl, '').split('?')[0];
    return path.split('/').filter(Boolean)[1] || '';
  }

  public override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.mangaSlug(mangaUrl);
    if (!slug) return [];
    const first = await this.get(
      `${this.baseUrl}/api/comics/${slug}/chapters?page=1&per_page=50&order=desc`,
      { headers: { Accept: 'application/json' } },
    );
    const firstBody = first.data as KunChapterListResponse;
    const lastPage = firstBody.data?.last_page || 1;
    const all = [...(firstBody.data?.chapters || [])];
    for (let p = 2; p <= lastPage; p++) {
      const res = await this.get(
        `${this.baseUrl}/api/comics/${slug}/chapters?page=${p}&per_page=50&order=desc`,
        { headers: { Accept: 'application/json' } },
      );
      const body = res.data as KunChapterListResponse;
      all.push(...(body.data?.chapters || []));
    }
    return all.map(ch => {
      const parsed = ch.updated_at ? Date.parse(ch.updated_at) : NaN;
      return {
        name: ch.chapter_name,
        url: `${this.baseUrl}/manga/${slug}/${ch.chapter_slug}`,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    });
  }
}
