import { BaseScraper } from './base';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Manga, Chapter, Page, SearchResult } from './types';

// Transcompilation of keiyoushi lib-multisrc/liliana (Liliana.kt):
// HTML gallery theme with ranking/all-manga listings, same-page details +
// chapters, and AJAX page-image lists keyed by an embedded chapter id.

interface LilianaPageListResponse {
  status?: boolean;
  msg?: string | null;
  html?: string;
}

function toJson(data: unknown): unknown {
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export abstract class LilianaScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  protected popularMangaSelector(): string {
    return 'div#main div.grid > div';
  }

  protected popularMangaNextPageSelector(): string | null {
    return '.blog-pager > span.pagecurrent + span';
  }

  protected imgAttr($img: Cheerio<any>): string {
    return this.absUrl(
      $img.attr('data-lazy-src') || $img.attr('data-src') || $img.attr('src') || '',
    );
  }

  protected popularMangaFromElement($: CheerioAPI, el: unknown): Manga | null {
    const $el = $(el as never);
    const $link = $el.find('.text-center a').first();
    const href = $link.attr('href');
    if (!href) return null;
    const $img = $el.find('img').first();
    return {
      title: $link.text().trim(),
      url: this.toPath(href),
      thumbnailUrl: $img.length ? this.imgAttr($img) : '',
      lang: this.lang,
    };
  }

  private toPath(href: string): string {
    try {
      return new URL(href.startsWith('http') ? href : this.absUrl(href)).pathname;
    } catch {
      return href;
    }
  }

  protected popularMangaParse(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $(this.popularMangaSelector()).toArray().forEach(el => {
      const manga = this.popularMangaFromElement($, el);
      if (manga) mangas.push(manga);
    });
    const nextSelector = this.popularMangaNextPageSelector();
    const hasNextPage = nextSelector ? $(nextSelector).length > 0 : false;
    return { mangas, hasNextPage };
  }

  override async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/ranking/week/${page}`);
    return this.popularMangaParse(String(res.data));
  }

  override async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/all-manga/${page}/?sort=last_update&status=0`);
    return this.popularMangaParse(String(res.data));
  }

  override async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    const url = trimmed
      ? `${this.baseUrl}/search/${page}/?keyword=${encodeURIComponent(trimmed)}`
      : `${this.baseUrl}/filter/${page}/`;
    const res = await this.get(url);
    return this.popularMangaParse(String(res.data));
  }

  protected mangaDetailsParse($: CheerioAPI): Manga {
    const title = $('.a2 header h1').first().text().trim();
    if (!title) throw new Error('Title not found');
    const $thumb = $('.a1 > figure img').first();
    const genre = $('.a2 div > a[rel="tag"].label').toArray()
      .map(el => $(el).text().trim())
      .filter(t => t.length > 0)
      .join(', ') || undefined;
    const authorRaw = $('div.y6x11p i.fas.fa-user + span.dt').first().text().trim();
    const author = authorRaw && authorRaw.toLowerCase() !== 'updating' ? authorRaw : undefined;
    const statusRaw = ($('div.y6x11p i.fas.fa-rss + span.dt').first().text() || '').trim().toLowerCase();
    return {
      title,
      url: '',
      thumbnailUrl: $thumb.length ? this.imgAttr($thumb) : '',
      lang: this.lang,
      description: $('div#syn-target').first().text().trim() || undefined,
      genre,
      author: author || undefined,
      status: ['ongoing', 'đang tiến hành', '進行中'].includes(statusRaw) ? 1
        : ['completed', 'hoàn thành', '完了'].includes(statusRaw) ? 0
        : ['on-hold', 'tạm ngưng', '保留'].includes(statusRaw) ? 3
        : ['canceled', 'đã huỷ', 'キャンセル'].includes(statusRaw) ? 2
        : undefined,
    };
  }

  override async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const details = this.mangaDetailsParse(this.$(String(res.data)));
    return { ...details, url: this.toPath(mangaUrl) };
  }

  protected chapterListSelector(): string {
    return 'ul > li.chapter';
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    return $(this.chapterListSelector()).toArray().map(el => {
      const $li = $(el);
      const epoch = $li.find('time[datetime]').first().attr('datetime');
      const seconds = epoch ? Number.parseInt(epoch, 10) : NaN;
      const $a = $li.find('a').first();
      const href = $a.attr('href') || '';
      return {
        name: $a.text().trim(),
        url: this.toPath(href),
        dateUpload: Number.isNaN(seconds) ? undefined : seconds * 1000,
      };
    });
  }

  private isPageImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    const path = lower.split('?')[0].split('#')[0];
    return !path.endsWith('.svg') && !lower.includes('loading_comments');
  }

  override async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    const scripts = $('script').toArray()
      .map(el => $(el).html() || '')
      .find(data => data.includes('const CHAPTER_ID'));
    if (!scripts) throw new Error('Failed to get chapter id');
    const chapterId = scripts.split('const CHAPTER_ID = ')[1]?.split(';')[0]?.trim();
    if (!chapterId) throw new Error('Failed to get chapter id');
    const ajax = await this.get(`${this.baseUrl}/ajax/image/list/chap/${chapterId}`, {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: this.absUrl(chapterUrl),
      },
    });
    const data = toJson(ajax.data) as LilianaPageListResponse;
    if (!data.status) throw new Error(data.msg || 'Unknown error');
    const $$ = this.$(`<body>${data.html ?? ''}</body>`);
    const indexed = $$('div.separator[data-index]');
    if (indexed.length > 0) {
      return indexed.toArray()
        .map(el => {
          const $sep = $$(el);
          const href = $sep.find('a').first().attr('href') || '';
          const full = href.startsWith('http') ? href : this.absUrl(href);
          const index = Number.parseInt($sep.attr('data-index') || '', 10);
          return { full, index };
        })
        .filter(p => this.isPageImageUrl(p.full) && !Number.isNaN(p.index))
        .sort((a, b) => a.index - b.index)
        .map(p => ({ index: p.index, imageUrl: p.full }));
    }
    return $$('div.separator').toArray()
      .map(el => {
        const href = $$(el).find('a').first().attr('href') || '';
        return href.startsWith('http') ? href : this.absUrl(href);
      })
      .filter(url => this.isPageImageUrl(url))
      .map((imageUrl, index) => ({ index, imageUrl }));
  }
}
