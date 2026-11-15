import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface RenderedDto {
  rendered?: string;
}

interface TermDto {
  name?: string;
}

interface MediaDto {
  source_url?: string;
}

interface EmbeddedDto {
  'wp:featuredmedia'?: MediaDto[];
  'wp:term'?: TermDto[][];
}

interface SeriesDto {
  id: number;
  slug: string;
  title?: RenderedDto;
  content?: RenderedDto;
  _embedded?: EmbeddedDto;
}

const LIST_FIELDS =
  'id,slug,title,content,_links.wp:featuredmedia,_links.wp:term,_embedded';
const EMBED = 'wp:featuredmedia,wp:term';

function parseJson<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

export class IThinkILikeYouScraper extends BaseScraper {
  readonly name = 'I Think I Like You';
  readonly baseUrl = 'https://ithinkilikeyou.net';
  readonly lang = 'all';

  private seriesPromise?: Promise<SeriesDto[]>;

  private loadSeries(): Promise<SeriesDto[]> {
    if (!this.seriesPromise) {
      this.seriesPromise = this.fetchSeries().catch(error => {
        this.seriesPromise = undefined;
        throw error;
      });
    }
    return this.seriesPromise;
  }

  private async fetchSeries(slug?: string): Promise<SeriesDto[]> {
    const params = new URLSearchParams({
      per_page: '100',
      _embed: EMBED,
      _fields: LIST_FIELDS,
    });
    if (slug) params.set('slug', slug);

    const res = await this.get(`/wp-json/wp/v2/series?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    return parseJson<SeriesDto[]>(res.data) ?? [];
  }

  private toManga(series: SeriesDto): Manga {
    const embedded = series._embedded;
    const terms = (embedded?.['wp:term'] ?? []).flat();
    const genres = terms
      .map(term => term.name?.trim())
      .filter((name): name is string => Boolean(name));
    const content = series.content?.rendered ?? '';
    const description =
      content && !content.includes('patron_only')
        ? this.$(content).text().replace(/\s+/g, ' ').trim() || undefined
        : undefined;

    return {
      title: unescapeHtml(series.title?.rendered ?? series.slug),
      url: this.absUrl(`/series/${series.slug}/`),
      thumbnailUrl: embedded?.['wp:featuredmedia']?.[0]?.source_url ?? '',
      lang: this.lang,
      genre: genres.join(', ') || undefined,
      description,
    };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const series = await this.loadSeries();
    return { mangas: series.map(item => this.toManga(item)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    if (!term) return this.getPopular();
    const series = await this.loadSeries();
    return {
      mangas: series
        .filter(item => unescapeHtml(item.title?.rendered ?? '').toLowerCase().includes(term))
        .map(item => this.toManga(item)),
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFromUrl(mangaUrl);
    if (!slug) return {};
    const series = await this.fetchSeries(slug);
    const item = series[0];
    if (!item) return {};
    return { ...this.toManga(item), url: this.absUrl(mangaUrl) };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    if (!slug) return [];

    const chapters: Chapter[] = [];
    let pageUrl: string | undefined = this.absUrl(`/series/${slug}/`);
    const seen = new Set<string>();

    while (pageUrl && !seen.has(pageUrl)) {
      seen.add(pageUrl);
      const res = await this.get(pageUrl);
      const $ = this.$(String(res.data));

      $('#comic-list li.comic').each((_, element) => {
        const item = $(element);
        const link = item.find('a[href]').first();
        const href = link.attr('href');
        if (!href) return;

        const title = item.find('.comic-title').first().text().trim() || 'Comic';
        const locked = item.find('img[src*="lockedTn"]').length > 0;
        const dateText = item.find('.comic-post-date').first().text().trim();
        const date = dateText ? Date.parse(dateText) : Number.NaN;

        chapters.push({
          name: locked ? `🔒 ${title}` : title,
          url: this.absUrl(href),
          dateUpload: Number.isNaN(date) ? undefined : date,
        });
      });

      pageUrl = $('nav.pagination a.next').first().attr('href')
        ? this.absUrl($('nav.pagination a.next').first().attr('href') ?? '')
        : undefined;
    }

    chapters.forEach((chapter, index) => {
      chapter.chapterNumber = chapters.length - index;
    });

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    return $('#spliced-comic img[class*="wp-image-"]')
      .toArray()
      .map(element => $(element).attr('src') ?? '')
      .filter(Boolean)
      .map((src, index) => ({ index, imageUrl: this.absUrl(src) }));
  }

  private slugFromUrl(mangaUrl: string): string | undefined {
    const path = this.absUrl(mangaUrl).split('?')[0].replace(/\/+$/, '');
    return path.split('/').filter(Boolean).pop();
  }
}
