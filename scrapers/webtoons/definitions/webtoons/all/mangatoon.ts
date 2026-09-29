import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const ONGOING_STATUS = [
  '连载', 'on going', 'sedang berlangsung', 'tiếp tục cập nhật',
  'en proceso', 'atualizando', 'เซเรียล', 'en cours', '連載中',
];

const COMPLETED_STATUS = [
  '完结', 'completed', 'tamat', 'đã full', 'terminada',
  'concluído', 'จบ', 'fin',
];

const POSTER_SUFFIX = /(jpg)-poster(.*)\d+?$/;

// Upstream: the page only renders a few episodes; the full list (with paid
// flags) is embedded as JSON in `data = JSON.parse('...');`
const EPISODES_LINE_REGEX = /data = JSON\.parse\('(.*)'\);/;
const JS_ESCAPE_REGEX = /\\(['"])/g;

interface EpisodeDto {
  id: number;
  title: string;
  weight: number;
  open_at?: string | null;
  is_fee?: boolean;
}

export class MangaToonScraper extends BaseScraper {
  readonly name = 'MangaToon (Limited)';
  readonly baseUrl = 'https://mangatoon.mobi';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const path = 'hot';
    const res = await this.get(`${this.baseUrl}/en/genre/${path}?type=1&page=${page - 1}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div.genre-content div.items a').map((_: any, el: any) => this.mangaFromElement($(el))).get();
    const hasNextPage = $('span.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(page: number): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/en/search?word=${encodeURIComponent(query)}`);
    const $ = this.$(res.data);
    // Upstream filters items whose resolved link starts with baseUrl
    // (Jsoup `a[abs:href^=...]`; transcribed since cheerio has no abs:href).
    const mangas: Manga[] = $('div.comics-result div.recommend-item').map((_: any, el: any) => {
      const $el = $(el);
      const href = $el.find('a').first().attr('href') || '';
      if (!this.absUrl(href).startsWith(this.baseUrl)) return null;
      return {
        title: $el.find('div.recommend-comics-title').text(),
        thumbnailUrl: this.normalPosterUrl(this.imgAttr($el.find('img'))), lang: this.lang,
        url: this.absUrl(href),
      };
    }).get().filter(Boolean) as Manga[];
    const hasNextPage = $('span.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Manga> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const locale = 'en';
    const manga: Manga = {
      title: $('h1.detail-title').text() || $('div.detail-title h1').text() || $('h1.entry-title').text() || '',
      url: mangaUrl,
      thumbnailUrl: '',
      lang: this.lang,
      author: $('div.detail-author-name span').text().split(': ')[1] || '',
      description: $('div.detail-description-short p').map((_: any, el: any) => $(el).text()).get().join('\n\n'),
      genre: $('div.detail-tags-info span').text()
        .split('/')
        .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
        .sort()
        .join(', '),
      status: this.toStatus($('div.detail-status').text()) as 0 | 1 | 2 | 3 | undefined,
    };
    const thumbnail = this.normalPosterUrl(this.imgAttr($('div.detail-img img')));
    if (!thumbnail.includes('cartoon-big-images')) {
      manga.thumbnailUrl = thumbnail;
    }
    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    // Upstream fetches the manga details page: chapters come from the embedded
    // episodes JSON (with paid flags), not from the rendered anchors.
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const firstHref = $('a.episode-item-new').first().attr('href') || '';
    const watchPath = firstHref.substring(0, firstHref.lastIndexOf('/'));
    if (!watchPath) return [];
    let episodes: EpisodeDto[] = [];
    // Upstream takes the FIRST script block containing the episodes JSON.
    $('script').each((_: any, el: any) => {
      if (episodes.length > 0) return false;
      const data = $(el).html() || '';
      for (const line of data.split('\n')) {
        const m = EPISODES_LINE_REGEX.exec(line);
        if (m && m[1]) {
          try {
            const parsed = JSON.parse(m[1].replace(JS_ESCAPE_REGEX, '$1')) as EpisodeDto[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              episodes = parsed;
              break;
            }
          } catch {
            // keep scanning other script lines
          }
        }
      }
    });
    return episodes
      .filter(e => !e.is_fee)
      .map(e => ({
        name: e.title,
        chapterNumber: e.weight,
        dateUpload: this.parseDate(e.open_at || ''),
        url: `${watchPath}/${e.id}`,
      }))
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages = $('div.pictures div img:first-child').map((i: number, el: any) => ({
      index: i,
      imageUrl: this.imgAttr($(el)),
    })).get();
    if (pages.length === 0) {
      throw new Error('This chapter is paid and can\'t be read. Use the MangaToon official app to purchase and read it.');
    }
    return pages;
  }

  private mangaFromElement($el: any): Manga {
    return {
      title: $el.find('div.content-title').text(),
      thumbnailUrl: this.normalPosterUrl(this.imgAttr($el.find('img'))),
      url: this.absUrl($el.attr('href') || ''),
      lang: this.lang,
    };
  }

  // Upstream Jsoup: data-src else abs:src. Cheerio has no abs:* attributes,
  // so resolve to absolute URLs explicitly.
  private imgAttr($el: any): string {
    const dataSrc: string | undefined = $el.attr('data-src');
    return this.absUrl(dataSrc || $el.attr('src') || '');
  }

  private normalPosterUrl(url: string | undefined): string {
    return url ? url.replace(POSTER_SUFFIX, '$1') : '';
  }

  private toStatus(status: string): number {
    const lower = status.toLowerCase();
    if (ONGOING_STATUS.some(s => lower.includes(s))) return 1;
    if (COMPLETED_STATUS.some(s => lower.includes(s))) return 2;
    return 0;
  }

  private parseDate(dateStr: string): number {
    if (!dateStr) return 0;
    return Date.parse(dateStr);
  }
}
