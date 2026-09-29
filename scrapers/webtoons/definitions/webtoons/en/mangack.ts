import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

interface RenderedDto {
  rendered: string;
}

interface FeaturedMediaDto {
  source_url?: string | null;
}

interface EmbeddedDto {
  'wp:featuredmedia'?: FeaturedMediaDto[];
}

interface MangackMangaDto {
  link: string;
  title: RenderedDto;
  _embedded?: EmbeddedDto;
}

interface ChapterContentDto {
  content?: RenderedDto | null;
}

const PAGE_SIZE = 24;
const IMG_SRC_REGEX = /<img[^>]+src=["']([^"']+)["']/g;
const SKIP_ASSET_REGEX = /\/wp-content\/(?:themes|plugins)\/|\/(?:logo|icon|cropped|preroll|placeholder|loading|spinner|chainsaw)[^/]*\.(?:png|jpe?g|webp|gif|svg)/i;
const RELATIVE_NUMBER_REGEX = /^(\d+)/;

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  rsquo: "'", '#8217': "'", lsquo: "'", '#8216': "'",
  rdquo: '"', '#8221': '"', ldquo: '"', '#8220': '"',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#?[a-zA-Z0-9]+);/g, (match, entity: string) => {
    const mapped = ENTITY_MAP[entity];
    if (mapped !== undefined) return mapped;
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);
      if (!Number.isNaN(code)) return String.fromCharCode(code);
    }
    return match;
  });
}

export class MangackScraper extends BaseScraper {
  readonly name = 'Mangack';
  readonly baseUrl = 'https://mangack.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/manga`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('_embed', 'wp:featuredmedia');
    url.searchParams.set('orderby', 'date');
    url.searchParams.set('order', 'desc');
    return this.mangaList(url.toString(), page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const path = page <= 1 ? '/updates/' : `/updates/page/${page}/`;
    const response = await this.get(`${this.baseUrl}${path}`);
    const $ = this.$(response.data as string);
    const mangas: Manga[] = [];
    $('.latestmanga .Latest_chapter_update').each((_, el) => {
      const $card = $(el);
      const link = $card.find('a[href*="/manga/"]').first();
      if (link.length === 0) return;
      const title = link.attr('title')?.trim() || link.text().trim();
      if (!title) return;
      const $img = $card.find('img').first();
      mangas.push({
        url: this.pathOf(link.attr('href') ?? ''),
        title,
        thumbnailUrl: this.imgAttr($img.attr('data-src'), $img.attr('data-lazy-src'), $img.attr('srcset'), $img.attr('src')),
        lang: this.lang,
      });
    });
    const hasNextPage = $('.pagination a.next, a.next.page-numbers').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/manga`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(PAGE_SIZE));
    url.searchParams.set('_embed', 'wp:featuredmedia');
    if (query.trim()) url.searchParams.set('search', query.trim());
    return this.mangaList(url.toString(), page);
  }

  private async mangaList(url: string, page: number): Promise<SearchResult> {
    const response = await this.get(url);
    const totalPages = Number(response.headers?.['x-wp-totalpages'] ?? 1) || 1;
    const list = response.data as MangackMangaDto[];
    const mangas: Manga[] = (list ?? []).map((dto) => ({
      url: this.pathOf(dto.link),
      title: decodeEntities(dto.title?.rendered ?? ''),
      thumbnailUrl: dto._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: page < totalPages };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data as string);
    const title = $('h1.entry-title').first().text().trim()
      || ($('meta[property="og:title"]').first().attr('content') ?? '').replace(/ mangack$/, '').trim();
    if (!title) throw new Error('Title not found');
    const articleClass = ($('article').first().attr('class') ?? '').split(/\s+/).filter(Boolean);
    const typeName = this.humanizeSlug(articleClass.find((c) => c.startsWith('comic-type-'))?.slice('comic-type-'.length) ?? '');
    const genreNames = articleClass.filter((c) => c.startsWith('Genres-')).map((c) => this.humanizeSlug(c.slice('Genres-'.length)));
    const statusSlug = articleClass.find((c) => c.startsWith('manga-status-'))?.slice('manga-status-'.length);
    const genre = [...genreNames, ...(typeName ? [typeName] : [])].filter((g) => g).join(', ') || undefined;
    const $cover = $('article figure img, article .mediumthumbnail1 img').first();
    const thumbnailUrl = $('meta[property="og:image"]').first().attr('content')
      || this.imgAttr($cover.attr('data-src'), $cover.attr('data-lazy-src'), $cover.attr('srcset'), $cover.attr('src'));
    return {
      title,
      thumbnailUrl,
      genre,
      status: this.parseStatus(statusSlug),
      description: this.buildDescription($) || undefined,
    };
  }

  private buildDescription($: CheerioAPI): string {
    const synopsis = ($('meta[property="og:description"]').first().attr('content') ?? '').trim();
    const infobox: Record<string, string> = {};
    $('article table.infobox tr').each((_, el) => {
      const $tr = $(el);
      const label = $tr.find('td:first-child, th:first-child').first().text();
      const rawValue = $tr.find('td:nth-child(2), th:nth-child(2)').first().text();
      infobox[label] = rawValue.includes('Warning') ? '' : rawValue;
    });
    let followers = '';
    let views = '';
    $('.follow-text').each((_, el) => {
      const text = $(el).text();
      if (text.toLowerCase().startsWith('followers')) followers = text;
      else if (text.toLowerCase().startsWith('views')) views = text;
    });
    const parts: string[] = [];
    if (synopsis) parts.push(synopsis);
    if (infobox['Alternative']) parts.push(`Alternative: ${infobox['Alternative']}`);
    if (infobox['Realized in']) parts.push(`Year: ${infobox['Realized in']}`);
    if (followers) parts.push(followers);
    if (views) parts.push(views);
    return parts.join('\n\n');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data as string);
    const chapters: Chapter[] = [];
    $('ul.chapterslist li').each((_, el) => {
      const $li = $(el);
      const link = $li.find('a.title, a[href*="/chapter/"]').first();
      if (link.length === 0) return;
      const url = this.pathOf(link.attr('href') ?? '');
      if (!url) return;
      const own = link.contents().toArray().map((n) => (n.type === 'text' ? $(n).text() : '')).join('').trim();
      chapters.push({
        url,
        name: own || link.text().trim(),
        dateUpload: this.parseChapterDate($li.find('.entry-date').first().text() || undefined),
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = chapterUrl.replace(/\/+$/, '').split('/').pop() ?? '';
    const url = new URL(`${this.baseUrl}/wp-json/wp/v2/chapter`);
    url.searchParams.set('slug', slug);
    url.searchParams.set('_fields', 'id,content');
    const response = await this.get(url.toString());
    const list = response.data as ChapterContentDto[];
    const html = list?.[0]?.content?.rendered ?? '';
    const urls = [...html.matchAll(IMG_SRC_REGEX)].map((m) => m[1]).filter((u) => u && !SKIP_ASSET_REGEX.test(u));
    return urls.map((imageUrl, index) => ({ imageUrl, index }));
  }

  private pathOf(href: string): string {
    if (!href) return '';
    try {
      const u = new URL(href, this.baseUrl);
      return `${u.pathname}${u.search}`;
    } catch {
      return href;
    }
  }

  private imgAttr(dataSrc?: string, lazySrc?: string, srcset?: string, src?: string): string {
    if (dataSrc) return this.absUrl(dataSrc);
    if (lazySrc) return this.absUrl(lazySrc);
    if (srcset) return this.absUrl(srcset.split(' ')[0] ?? '');
    return this.absUrl(src ?? '');
  }

  private parseStatus(slug: string | undefined): MangaStatus {
    switch (slug?.toLowerCase()) {
      case 'ongoing':
      case 'publishing':
      case 'updating':
        return 1;
      case 'completed':
      case 'complete':
      case 'finished':
        return 0;
      case 'hiatus':
      case 'on-hiatus':
      case 'on-hold':
        return 3;
      case 'cancelled':
      case 'canceled':
      case 'dropped':
        return 2;
      default:
        return undefined;
    }
  }

  private humanizeSlug(slug: string): string {
    return slug.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  private parseChapterDate(raw: string | undefined): number {
    if (!raw) return 0;
    const text = raw.toLowerCase();
    const num = Number(text.match(RELATIVE_NUMBER_REGEX)?.[1]);
    if (!Number.isNaN(num) && text.match(RELATIVE_NUMBER_REGEX)) {
      const msPerUnit = text.includes('second') ? 1000
        : text.includes('minute') ? 60000
        : text.includes('hour') ? 3600000
        : text.includes('day') ? 86400000
        : text.includes('week') ? 604800000
        : text.includes('month') ? 2592000000
        : text.includes('year') ? 31536000000
        : 0;
      if (msPerUnit > 0) return Date.now() - num * msPerUnit;
      return 0;
    }
    const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (m) {
      const month = MONTHS[m[1].toLowerCase()];
      if (month !== undefined) return Date.UTC(Number(m[3]), month, Number(m[2]));
    }
    return 0;
  }
}
