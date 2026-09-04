import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

interface MgreadSearchDto {
  id: number;
  title: string;
  url: string;
  thumb?: string;
}

interface ChapterDto {
  title?: string;
  number?: number;
  slug?: string;
  created_at?: string;
}

interface ChapterListDto {
  items?: ChapterDto[];
  total_pages?: number;
}

function statusOf(s: string | undefined): MangaStatus {
  switch (s?.toLowerCase().trim()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'dropped': return 2;
    case 'season end':
    case 'source hiatus':
    case 'caught up': return 3;
    default: return 3;
  }
}

function isAnimeEntry(title: string, url: string): boolean {
  const normalized = title.toLowerCase();
  return (
    normalized.startsWith('anime -') ||
    normalized.startsWith('anime –') ||
    url.replace(/\/$/, '').split('/').pop()!.startsWith('anime-')
  );
}

export class MgreadioScraper extends BaseScraper {
  readonly name = 'Mgread.io';
  readonly baseUrl = 'https://mgread.io';
  readonly lang = 'en';

  private pageUrl(slug: string, page: number): string {
    return page === 1 ? `${this.baseUrl}/${slug}/` : `${this.baseUrl}/${slug}/page/${page}/`;
  }

  private mangaFromGridElement($: CheerioAPI, el: Element): Manga {
    const $el = $(el);
    const titleEl = $el.find('h2 a[href*="/manga/"]').first();
    let href = titleEl.attr('href');
    let title = titleEl.text().trim();
    if (!href) {
      const fallback = $el.find('a[href*="/manga/"]:not([href*="/chapter-"])').first();
      href = fallback.attr('href');
      title = fallback.text().trim();
    }
    if (!href) throw new Error('Manga link not found in grid item');
    const url = new URL(this.absUrl(href)).pathname;
    const img = $el.find('img').first();
    const thumbnailUrl =
      img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';
    return { title, url, thumbnailUrl: this.absUrl(thumbnailUrl), lang: this.lang };
  }

  private mangasPageFromHtml(html: string): SearchResult {
    const $root = this.$(html);
    const $ = $root('.manga-item-grid');
    const mangas = $.toArray().map(el => this.mangaFromGridElement($root, el));
    const hasNextPage = $root("li:not(.uk-disabled) > a[aria-label='Next page']").length > 0;
    const filtered = mangas.filter(m => !isAnimeEntry(m.title, m.url));
    return { mangas: filtered, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.pageUrl('manga-ranking', page));
    return this.mangasPageFromHtml(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.pageUrl('recently-updated', page));
    return this.mangasPageFromHtml(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.trim()) {
      const url = `${this.baseUrl}/wp-json/initlise/v1/search?term=${encodeURIComponent(query.trim())}&page=${page}`;
      const res = await this.get(url);
      const mangas: Manga[] = (res.data as MgreadSearchDto[] || [])
        .map(dto => {
          const parsedTitle = this.$(dto.title).text();
          const cleanUrl = dto.url.trim();
          if (!cleanUrl) return null;
          return {
            title: parsedTitle,
            url: new URL(cleanUrl).pathname,
            thumbnailUrl: dto.thumb || '',
            lang: this.lang,
          };
        })
        .filter((m): m is Manga => !!m && !isAnimeEntry(m.title, m.url));
      return { mangas, hasNextPage: false };
    }

    const url = this.pageUrl('advanced-filter', page);
    const res = await this.get(url);
    return this.mangasPageFromHtml(res.data);
  }

  private mangaDetailsFromHtml(html: string, pageUrl: string): Partial<Manga> {
    const $ = this.$(html);

    let title = $('#manga-title').first().contents()
      .filter((_, n) => n.type === 'text').text().trim();
    if (!title) {
      title = ($('meta[property="og:title"]').attr('content') || '').split(' [Ch.')[0].trim();
    }

    const coverEl = $('.story-cover img').first();
    const thumbnailUrl = coverEl.attr('data-src') || coverEl.attr('src') || $('meta[property="og:image"]').attr('content') || '';

    const descriptionText = $('#manga-description').first().text().trim()
      || $('meta[name="description"]').attr('content')?.trim() || '';

    const genres = $('#genre-tags a[href*="/genre/"]').toArray().map(el => {
      const t = $(el).contents().filter((_, n) => n.type === 'text').text().trim();
      return t || $(el).text().trim();
    });

    const metaRow = $('#manga-title + div').first();
    const metadata: string[] = [];
    const metaOwnText = metaRow.contents().filter((_, n) => n.type === 'text').text()
      .split('Chapters')[0].trim();
    if (metaOwnText) metadata.push(`Chapters: ${metaOwnText}`);
    const alt = $('#comic-othername').text().trim();
    if (alt) metadata.push(`Alternative title: ${alt}`);
    const rating = $('.init-review-info').text().trim();
    if (rating) metadata.push(`Rating: ${rating}`);
    const views = metaRow.find('.init-plugin-suite-view-count-number').text().trim();
    if (views) metadata.push(`Views: ${views}`);
    const lastUpdated = $('#last-updated').text().trim();
    if (lastUpdated) metadata.push(`Last updated: ${lastUpdated}`);

    let description = descriptionText;
    if (metadata.length) {
      description = descriptionText ? `${descriptionText}\n\n${metadata.join('\n')}` : metadata.join('\n');
    }

    return {
      title,
      url: new URL(pageUrl).pathname,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      genre: genres.join(', ') || undefined,
      status: statusOf($('#manga-status').text().trim()),
      description: description || undefined,
      lang: this.lang,
    };
  }

  private mangaIdFromHtml(html: string): number {
    const $ = this.$(html);
    const el = $('#manga-title[data-id], #chapter-search-input[data-manga-id]').first();
    const id = el.attr('data-id') || el.attr('data-manga-id') || '';
    const num = parseInt(id, 10);
    if (Number.isNaN(num)) throw new Error('Manga ID not found');
    return num;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    return this.mangaDetailsFromHtml(res.data, res.config.url || this.absUrl(mangaUrl));
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const mangaPath = mangaUrl.split('/chapter/')[0].replace(/\/$/, '');
    const pageRes = await this.get(this.absUrl(mangaUrl));
    const mangaId = this.mangaIdFromHtml(pageRes.data);

    const page = async (n: number): Promise<ChapterListDto> => {
      const url = `${this.baseUrl}/wp-json/initmanga/v1/chapters?manga_id=${mangaId}&paged=${n}&per_page=50`;
      const res = await this.get(url);
      return res.data as ChapterListDto;
    };

    const first = await page(1);
    const totalPages = first.total_pages || 1;
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => page(i + 2)),
    );

    const chapters: Chapter[] = [first, ...rest].flatMap(p =>
      (p.items || []).map(ch => {
        const num = ch.number ?? -1;
        const chapterName = String(num);
        const cleanMangaPath = mangaPath.replace(/\/+$/, '');
        const slug = ch.slug || '';
        const name = ch.title ? `Chapter ${chapterName} - ${ch.title}` : `Chapter ${chapterName}`;
        return {
          name,
          url: `${cleanMangaPath}/${slug}/`,
          chapterNumber: num,
          dateUpload: ch.created_at ? new Date(`${ch.created_at} UTC`).getTime() : undefined,
        };
      }),
    );
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    return $('#chapter-content img[data-original-src]').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('data-original-src') || ''),
    }));
  }
}