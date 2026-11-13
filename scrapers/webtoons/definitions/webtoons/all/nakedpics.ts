import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface GalleryDto {
  g_url: string;
  desc: string;
  t_url_460: string;
  gid: string;
}

export class NakedPicsScraper extends BaseScraper {
  readonly name = 'NakedPics';
  readonly baseUrl = 'https://hotnakedwomen.com';
  readonly lang = 'all';
  private readonly searchSlugCache = new Map<string, string>();

  private listUrl(segments: string[]): string {
    const path = segments.map(segment => encodeURIComponent(segment)).join('/');
    return `${this.baseUrl}/${path}/`;
  }

  private parseCards($: CheerioAPI): { mangas: Manga[]; cards: number } {
    const mangas: Manga[] = [];

    $("[itemprop='associatedMedia'] > a[href*='/gals/']").each((_, element) => {
      const link = $(element);
      const href = link.attr('href') ?? '';
      const img = link.find('img').first();
      const alt = (img.attr('alt') ?? '').trim();
      if (!href || !alt) return;

      const tid = (link.attr('data-tid') ?? '').split('_')[0];
      const title = tid && alt.endsWith(` ${tid}`) ? alt.slice(0, alt.length - tid.length - 1).trim() : alt;

      mangas.push({
        title,
        url: href,
        thumbnailUrl: this.absUrl(img.attr('data-src') ?? img.attr('src') ?? ''),
        lang: this.lang,
      });
    });

    if (mangas.length === 0) {
      $("a[href*='/gals/'] img[alt]").each((_, element) => {
        const img = $(element);
        const link = img.closest('a');
        const href = link.attr('href') ?? '';
        const alt = (img.attr('alt') ?? '').trim();
        if (!href || !alt) return;

        const tid = (link.attr('data-tid') ?? '').split('_')[0];
        const title = tid && alt.endsWith(` ${tid}`) ? alt.slice(0, alt.length - tid.length - 1).trim() : alt;
        mangas.push({
          title,
          url: href,
          thumbnailUrl: this.absUrl(img.attr('data-src') ?? img.attr('src') ?? ''),
          lang: this.lang,
        });
      });
    }

    const cards = mangas.length;
    const unique = new Map<string, Manga>();
    for (const manga of mangas) if (!unique.has(manga.url)) unique.set(manga.url, manga);
    return { mangas: [...unique.values()], cards };
  }

  private categoryId($: CheerioAPI): string | null {
    const scripts = $('script')
      .map((_, element) => $(element).html() ?? '')
      .get()
      .join('\n');
    const match = /(?:["']?cat["']?|CID)\s*[:=]\s*["']?([\w-]+)["']?/i.exec(scripts);
    return match ? match[1] : null;
  }

  private async getList(url: string, page: number): Promise<SearchResult> {
    const res = await this.get(url);
    const $ = this.$(res.data);

    if (page === 1) {
      const { mangas, cards } = this.parseCards($);
      return { mangas, hasNextPage: cards >= 30 };
    }

    const cat = this.categoryId($);
    if (!cat) {
      throw new Error(`${this.name}: unable to resolve gallery category for pagination`);
    }

    const requestUrl = (res.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl ?? this.absUrl(url);
    const ajaxUrl = new URL(requestUrl);
    ajaxUrl.searchParams.set('cat', cat);
    ajaxUrl.searchParams.set('limit', '30');
    ajaxUrl.searchParams.set('offset', String((page - 1) * 30));
    ajaxUrl.searchParams.set('lang', 'en');

    const ajax = await this.get(ajaxUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const items = ajax.data as GalleryDto[];
    const mangas: Manga[] = [];
    for (const item of items) {
      let parsed: URL;
      try {
        parsed = new URL(item.g_url, this.baseUrl);
      } catch {
        continue;
      }
      if (parsed.hostname !== new URL(this.baseUrl).hostname) continue;
      if (parsed.pathname.split('/').filter(Boolean)[0] !== 'gals') continue;

      const title = item.desc.replace(new RegExp(` ${item.gid}$`), '').trim();
      if (!title) continue;

      mangas.push({
        title,
        url: parsed.pathname,
        thumbnailUrl: item.t_url_460,
        lang: this.lang,
      });
    }

    return { mangas, hasNextPage: items.length >= 30 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getList(this.listUrl(['popular']), page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getList(this.listUrl(['recent']), page);
  }

  private searchSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return this.getPopular(page);

    const words = trimmed.split(/\s+/).filter(Boolean);
    const candidates = [
      words.join(' '),
      words.slice(0, 2).join(' '),
      words[0] ?? '',
    ]
      .map(value => this.searchSlug(value))
      .filter(Boolean);
    const cached = this.searchSlugCache.get(trimmed);
    const slugs = cached
      ? [cached, ...candidates.filter(slug => slug !== cached)]
      : candidates;

    for (const slug of slugs) {
      try {
        const result = await this.getList(this.listUrl(['search', slug]), page);
        if (result.mangas.length > 0 || page > 1) {
          this.searchSlugCache.set(trimmed, slug);
          return result;
        }
      } catch {
        // A long title often has no tag page; try a shorter tag next.
      }
    }

    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const title = $("h1[itemprop='name']").first().text().trim() || $('h1').first().text().trim();
    const galleryImage = $("[itemprop='associatedMedia'] > a[data-pswp-width] img").first();
    const thumbnailUrl =
      $("img[itemprop='thumbnailUrl']").first().attr('src') ??
      galleryImage.attr('data-src') ??
      galleryImage.attr('src') ??
      $("meta[property='og:image']").attr('content') ??
      '';

    const models: string[] = [];
    $("[itemtype$='ImageGallery'] li > a").each((_, element) => {
      if ($(element).children('i.icon-mod').length === 0) return;
      const model = $(element).text().trim();
      if (model) models.push(model);
    });

    const channels: string[] = [];
    $("[itemtype$='ImageGallery'] li > a").each((_, element) => {
      if ($(element).children('i.icon-cat2').length === 0) return;
      const channel = $(element).text().trim();
      if (channel) channels.push(channel);
    });

    const genres: string[] = [];
    $("[itemtype$='ImageGallery'] li > a").each((_, element) => {
      if ($(element).children('i.icon-tag2-1').length === 0) return;
      const genre = $(element).text().trim();
      if (genre) genres.push(genre);
    });

    const description = $('.desc, [itemprop="description"]').first().text().trim();
    const author = models.join(', ');

    return {
      title,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: author || undefined,
      artist: author || undefined,
      genre: [...channels, ...genres].join(', ') || undefined,
      description: description.replace(/\s+/g, ' ').trim() || undefined,
      status: /\b\d+\s*photos?\b/i.test(description) ? 0 : undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const details = await this.getMangaDetails(mangaUrl);
    return [
      {
        name: details.title ?? 'Gallery',
        url: this.absUrl(mangaUrl),
        chapterNumber: 1,
      },
    ];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    const images: string[] = [];
    const seen = new Set<string>();
    $("[itemprop='associatedMedia'] > a[data-pswp-width]").each((_, element) => {
      const href = $(element).attr('href') ?? '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      images.push(this.absUrl(href));
    });

    return images.map((imageUrl, index) => ({ imageUrl, index }));
  }
}
