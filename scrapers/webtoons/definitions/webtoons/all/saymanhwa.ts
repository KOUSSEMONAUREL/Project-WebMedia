import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

const STATUS_WORDS: Record<string, { ongoing: string[]; completed: string[] }> = {
  ar: { ongoing: ['مستمر'], completed: ['مكتمل'] },
  de: { ongoing: ['laufend'], completed: ['abgeschlossen'] },
  es: { ongoing: ['en curso'], completed: ['completado'] },
  fil: { ongoing: ['tuloy-tuloy', 'tuloy tuloy'], completed: ['tapos'] },
  fr: { ongoing: ['en cours'], completed: ['terminé', 'termine'] },
  id: { ongoing: ['berjalan'], completed: ['selesai'] },
  ja: { ongoing: ['連載中'], completed: ['完結'] },
  'pt-br': { ongoing: ['em andamento'], completed: ['concluído', 'concluido'] },
  th: { ongoing: ['กำลังดำเนิน'], completed: ['จบแล้ว'] },
  vi: { ongoing: ['đang tiến hành', 'đang'], completed: ['hoàn thành'] },
  'zh-cn': { ongoing: ['连载中', '連載中'], completed: ['已完结', '已完結', '完结', '完結'] },
  'zh-tw': { ongoing: ['连载中', '連載中'], completed: ['已完结', '已完結', '完结', '完結'] },
};

export class SaymanhwaScraper extends BaseScraper {
  readonly name = 'SayManhwa';
  readonly baseUrl = 'https://saymanhwa.com';
  readonly lang = 'all';

  private get saymanhwaLang(): string {
    const lang = this.lang as string;
    switch (lang) {
      case 'pt': return 'pt-br';
      case 'zh': return 'zh-cn';
      default: return 'en';
    }
  }

  private parseMangaPage($: CheerioAPI, page: number): SearchResult {
    const mangas: Manga[] = $('article.series-card').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('.series-card-body h2 a').first();
      return {
        title: link.text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl($el.find('.series-card-cover img, a img').first().attr('src') || ''),
        lang: this.lang,
      };
    });
    const hasNextPage = $('nav.pagination span + a').length > 0;
    return { mangas, hasNextPage };
  }

  private toStatus(text: string | undefined): MangaStatus {
    if (!text || !text.trim()) return 3;
    const words = STATUS_WORDS[this.saymanhwaLang];
    const key = words || { ongoing: ['ongoing'], completed: ['completed'] };
    if (key.ongoing.some(w => text.toLowerCase().includes(w))) return 1;
    if (key.completed.some(w => text.toLowerCase().includes(w))) return 0;
    return 3;
  }

  private mangaUrlFrom(url: string): string {
    if (/chapter-$/.test(url)) return url.slice(0, url.lastIndexOf('/'));
    return url;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/${this.saymanhwaLang}/popular` + (page !== 1 ? `?page=${page}` : '');
    const res = await this.get(url);
    return this.parseMangaPage(this.$(res.data), page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/${this.saymanhwaLang}/latest` + (page !== 1 ? `?page=${page}` : '');
    const res = await this.get(url);
    return this.parseMangaPage(this.$(res.data), page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (page !== 1) params.set('page', page.toString());
    const qs = params.toString();
    const url = `${this.baseUrl}/${this.saymanhwaLang}/series` + (qs ? `?${qs}` : '');
    const res = await this.get(url);
    return this.parseMangaPage(this.$(res.data), page);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(res.data);
    const cleanUrl = mangaUrl.split('/chapter-')[0];

    const creatorRows = $('.series-v72-meta-row strong.series-creator-links').toArray();
    const author = creatorRows[0] ? $(creatorRows[0]).find('a').map((_, e) => $(e).text()).get().join(', ') : undefined;
    const artist = creatorRows[1] ? $(creatorRows[1]).find('a').map((_, e) => $(e).text()).get().join(', ') : undefined;

    const status = this.toStatus($('.series-v72-meta-pair > div:first-child strong').first().text());
    const type = $('.series-v72-meta-pair > div:nth-child(2) strong').first().text();
    const genres = $('a[href*="/genres/"]').toArray().map(el => $(el).text());

    return {
      title: $('h1').first().contents().filter((_, n) => n.type === 'text').text().trim(),
      url: cleanUrl,
      thumbnailUrl: this.absUrl($('.series-v72-cover img').first().attr('src') || ''),
      author,
      artist,
      status,
      genre: [type, ...genres].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || undefined,
      description: $('.series-seo-context p').first().text().trim() || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl.split('/chapter-')[0]));
    const $ = this.$(res.data);
    return $('.series-v72-chapter-list > a.series-v72-chapter-row').toArray().map(el => {
      const $el = $(el);
      const chapterName = $el.find('.series-chapter-number-text').first().contents()
        .filter((_, n) => n.type === 'text').text().trim();
      const isVip = $el.find('.chapter-mini-lock').length > 0;
      const dateStr = $el.find('time').attr('datetime');
      return {
        name: isVip ? `🔒 ${chapterName}` : chapterName,
        url: this.absUrl($el.attr('href') || ''),
        dateUpload: dateStr ? new Date(dateStr).getTime() : undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(res.data);
    return $('.reader-pages img').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}