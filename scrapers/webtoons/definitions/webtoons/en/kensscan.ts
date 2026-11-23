import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';
import type { Manga, SearchResult } from '../../../engine/types';

export class KensscanScraper extends MadaraScraper {
  constructor() {
    super('Kensscan', 'https://kensscan.com', 'en');
  }

  protected override readonly filterNonMangaItems = false;
  protected override readonly useLoadMoreRequest = 'Never';

  protected override readonly popularMangaSelectorStr =
    'div.manga-item, div.c-tabs-item__content';
  protected override readonly popularMangaUrlSelector =
    'h3.manga-title a, .post-title a';
  protected override readonly searchMangaSelectorStr =
    'div.manga-item, div.c-tabs-item__content';
  protected override readonly searchMangaUrlSelector =
    'h3.manga-title a, .post-title a';

  protected override readonly mangaDetailsSelectorTitle = 'h1.title';
  protected override readonly mangaDetailsSelectorDescription =
    'div.manga-meta-item.description';

  // Les chapitres VIP portent la classe kvp-row--locked sur le li.
  protected override readonly chapterListSelectorStr =
    'li.wp-manga-chapter:not(.kvp-row--locked)';
  protected override readonly chapterDateSelectorStr = '.chapter-release-date';
  protected override readonly pageListParseSelector =
    'div.reading-content img.wp-manga-chapter-img';

  protected override popularMangaNextPageSelector(): string | null {
    return 'a.next.page-numbers';
  }

  protected override searchMangaNextPageSelector(): string | null {
    return 'a.next.page-numbers';
  }

  // Le moteur de recherche du site ignore la ponctuation typographique et
  // traite les requetes de plus de 9 mots comme une phrase unique. Il est
  // aussi tres lent (souvent >30 s), donc on bascule sur le sitemap si la
  // recherche HTML ne repond pas assez vite.
  override async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (/^https?:\/\//.test(query) || query.startsWith('slug:')) {
      return super.getSearch(query, page);
    }
    const normalized = query
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 9)
      .join(' ');

    try {
      const pagePath = page > 1 ? `page/${page}/` : '';
      const url = `${this.baseUrl}/${pagePath}?s=${encodeURIComponent(normalized)}&post_type=wp-manga`;
      const res = await this.get(url, { timeout: 7_000 });
      const result = this.searchMangaParse(String(res.data));
      if (result.mangas.length > 0) return result;
    } catch {
      // Le sitemap reste disponible quand la recherche HTML expire.
    }

    return this.searchFromSitemap(normalized, page);
  }

  private sitemapCache: Manga[] | null = null;

  private async sitemapMangas(): Promise<Manga[]> {
    if (this.sitemapCache) return this.sitemapCache;

    const res = await this.get(
      `${this.baseUrl}/wp-sitemap-posts-wp-manga-1.xml`,
      { timeout: 10_000 },
    );
    const seen = new Set<string>();
    const mangas: Manga[] = [];

    for (const match of String(res.data).matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = match[1].trim();
      const slug = url.match(/\/manga\/([^/?#]+)\/?$/)?.[1];
      if (!slug || seen.has(slug)) continue;

      seen.add(slug);
      mangas.push({
        title: slug
          .split('-')
          .filter(Boolean)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
        url: `${this.baseUrl}/manga/${slug}/`,
        thumbnailUrl: '',
        lang: this.lang,
      });
    }

    this.sitemapCache = mangas;
    return mangas;
  }

  private async pageFromSitemap(page: number): Promise<SearchResult> {
    const mangas = await this.sitemapMangas();
    const perPage = 20;
    const start = (page - 1) * perPage;
    return {
      mangas: mangas.slice(start, start + perPage),
      hasNextPage: start + perPage < mangas.length,
    };
  }

  private async searchFromSitemap(query: string, page: number): Promise<SearchResult> {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (await this.sitemapMangas()).filter(manga => {
      const words = new URL(manga.url).pathname
        .split('/')
        .filter(Boolean)
        .pop()!
        .split('-');
      return tokens.every(token => words.some(word => word.includes(token)));
    });

    const perPage = 20;
    const start = (page - 1) * perPage;
    return {
      mangas: matches.slice(start, start + perPage),
      hasNextPage: start + perPage < matches.length,
    };
  }

  // Les archives HTML du site expirent souvent au-dela de 30 s. On tente
  // une reponse rapide puis on retombe sur le sitemap, qui reste joignable.
  override async getPopular(page = 1): Promise<SearchResult> {
    try {
      const url = `${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?m_orderby=views`;
      const res = await this.get(url, { timeout: 8_000 });
      const result = this.popularMangaParse(String(res.data));
      if (result.mangas.length > 0) return result;
    } catch {
      // fallback sitemap
    }
    return this.pageFromSitemap(page);
  }

  override async getLatest(page = 1): Promise<SearchResult> {
    try {
      const url = `${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?m_orderby=latest`;
      const res = await this.get(url, { timeout: 8_000 });
      const result = this.popularMangaParse(String(res.data));
      if (result.mangas.length > 0) return result;
    } catch {
      // fallback sitemap
    }
    return this.pageFromSitemap(page);
  }

  protected override mangaDetailsParse(
    $: CheerioAPI,
    mangaUrl: string,
  ): Partial<Manga> {
    const manga = super.mangaDetailsParse($, mangaUrl);
    const thumbnail = $('meta[property="og:image"]').attr('content')?.trim();
    if (thumbnail) manga.thumbnailUrl = this.absUrl(thumbnail);
    return manga;
  }
}
