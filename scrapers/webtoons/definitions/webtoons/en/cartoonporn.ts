import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/cartoonporn` (CartoonPorn.kt, Madara theme).
 *
 * Listing pages are `/porncomic/?m_orderby=views&m_order=desc` (popular) and
 * `?m_orderby=recent` (latest); search goes through the WP `?s=` endpoint
 * (redirected to `/search/<query>/`) with the same item markup. Chapters are
 * the 3-segment `/porncomic/<manga>/<chapter>` links on the manga page, and
 * reader images are the `img.manga-img` under `/WP-manga/data/`.
 */
export class CartoonpornScraper extends MadaraScraper {
  constructor() { super('CartoonPorn', 'https://cartoonporn.to', 'en'); }

  protected override readonly mangaSubString = 'porncomic';

  protected override readonly mangaDetailsSelectorTitle = 'h1.comic-hero__title';
  protected override readonly mangaDetailsSelectorThumbnail = '.comic-hero__image-wrap img';
  protected override readonly mangaDetailsSelectorArtist = '.meta-tag--artist';
  protected override readonly mangaDetailsSelectorGenre = '.meta-tag--genre';

  public override async getPopular(page = 1): Promise<SearchResult> {
    return this.htmlList(page, 'views');
  }

  public override async getLatest(page = 1): Promise<SearchResult> {
    return this.htmlList(page, 'recent');
  }

  public override async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://') || query.startsWith('slug:')) {
      return super.getSearch(query, page);
    }
    const res = await this.get(`${this.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`);
    const $ = this.$(res.data);
    const mangas = $(this.archiveSelector()).toArray()
      .map(el => this.archiveManga($(el)))
      .filter((m): m is Manga => m !== null);
    return { mangas, hasNextPage: false };
  }

  private archiveSelector(): string {
    return 'div.item_content, div.item-thumb';
  }

  private async htmlList(page: number, orderBy: string): Promise<SearchResult> {
    const path = page === 1 ? '/porncomic/' : `/porncomic/page/${page}/`;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('m_orderby', orderBy);
    if (orderBy === 'views') url.searchParams.set('m_order', 'desc');
    const res = await this.get(url.toString());
    const $ = this.$(res.data);
    const mangas = $(this.archiveSelector()).toArray()
      .map(el => this.archiveManga($(el)))
      .filter((m): m is Manga => m !== null);
    const hasNextPage = $(`a[href*='/porncomic/page/${page + 1}/']`).length > 0;
    return { mangas, hasNextPage };
  }

  private archiveManga($el: ReturnType<CheerioAPI>): Manga | null {
    const link = $el.find(`a[href*='/porncomic/']`).first();
    if (link.length === 0) return null;
    const href = link.attr('href') || '';
    let mangaPath = '';
    try {
      mangaPath = new URL(href, this.baseUrl).pathname;
    } catch {
      return null;
    }
    if (!mangaPath) return null;
    const title = (link.attr('title') || '').trim() || link.text().trim();
    if (!title) return null;
    const img = $el.find('img').first();
    const thumbnailUrl = img.length > 0 ? this.imageFromElement(img) : null;
    return { title, url: this.absUrl(mangaPath), thumbnailUrl: thumbnailUrl || '', lang: this.lang };
  }

  public override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const comicSlug = mangaUrl.replace(/\/$/, '').split('/').pop() ?? '';
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    $('a[href*="/porncomic/"]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      let segments: string[] = [];
      try {
        segments = new URL(href, this.baseUrl).pathname.replace(/^\/|\/$/g, '').split('/');
      } catch {
        return;
      }
      if (segments.length !== 3 || segments[0] !== this.mangaSubString || segments[1] !== comicSlug) return;
      const abs = this.absUrl(href);
      if (seen.has(abs)) return;
      seen.add(abs);
      const slug = segments[2] ?? '';
      if (!slug) return;
      const name = slug.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
      chapters.push({ name, url: abs });
    });
    return chapters;
  }

  public override async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const seen = new Set<string>();
    const pages: Page[] = [];
    $('img.manga-img').each((_i, el) => {
      const src = this.imageFromElement($(el));
      if (!src || !src.includes('/WP-manga/data/') || seen.has(src)) return;
      seen.add(src);
      pages.push({ index: pages.length, imageUrl: src });
    });
    return pages;
  }
}
