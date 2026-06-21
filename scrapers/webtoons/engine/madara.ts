import type { AxiosRequestConfig } from 'axios';
import type { CheerioAPI, AnyNode } from 'cheerio';
import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

class WordSet {
  constructor(private readonly words: string[]) {}
  anyWordIn(s: string): boolean {
    return this.words.some(w => s.toLowerCase().includes(w.toLowerCase()));
  }
  startsWith(s: string): boolean {
    return this.words.some(w => s.toLowerCase().startsWith(w.toLowerCase()));
  }
  endsWith(s: string): boolean {
    return this.words.some(w => s.toLowerCase().endsWith(w.toLowerCase()));
  }
}

type LoadMoreStrategy = 'AutoDetect' | 'Always' | 'Never';
type LoadMoreDetection = 'Pending' | 'True' | 'False';

const URL_SEARCH_PREFIX = 'slug:';
const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/;

export abstract class MadaraScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected readonly mangaSubString = 'manga';
  protected readonly filterNonMangaItems = true;
  protected readonly useLoadMoreRequest: LoadMoreStrategy = 'AutoDetect';
  protected readonly useNewChapterEndpoint = false;

  protected readonly popularMangaSelectorStr = "div.page-item-detail:not(:has(a[href*='bilibilicomics.com'])) , .manga__item";
  protected readonly popularMangaUrlSelector = 'div.post-title a';
  protected readonly popularMangaUrlSelectorImg = 'img';
  protected readonly searchMangaSelectorStr = "div.c-tabs-item__content , .manga__item";
  protected readonly searchMangaUrlSelector = 'div.post-title a';

  protected readonly mangaDetailsSelectorTitle = "div.post-title h3, div.post-title h1, #manga-title > h1";
  protected readonly mangaDetailsSelectorAuthor = "div.author-content > a, div.manga-authors > a";
  protected readonly mangaDetailsSelectorArtist = "div.artist-content > a";
  protected readonly mangaDetailsSelectorStatus = "div.summary-content, div.summary-heading:contains(Status) + div";
  protected readonly mangaDetailsSelectorDescription = "div.description-summary div.summary__content, div.summary_content div.post-content_item > h5 + div, div.summary_content div.manga-excerpt";
  protected readonly mangaDetailsSelectorThumbnail = "div.summary_image img";
  protected readonly mangaDetailsSelectorGenre = "div.genres-content a";
  protected readonly mangaDetailsSelectorTag = "div.tags-content a";

  protected readonly seriesTypeSelector = ".post-content_item:contains(Type) .summary-content";
  protected readonly altNameSelector = ".post-content_item:contains(Alt) .summary-content";
  protected readonly altName = 'Alternative :';

  protected readonly chapterListSelectorStr = 'li.wp-manga-chapter';
  protected readonly chapterDateSelectorStr = 'span.chapter-release-date';
  protected readonly chapterUrlSelector = 'a';
  protected readonly chapterUrlSuffix = '?style=list';

  protected readonly pageListParseSelector = "div.page-break, li.blocks-gallery-item, .reading-content .text-left:not(:has(.blocks-gallery-item)) img";

  protected readonly completedStatusList = [
    'Completed', 'Completo', 'Completado', 'Concluído', 'Concluido',
    'Finalizado', 'Achevé', 'Terminé', 'Hoàn Thành', 'مكتملة', 'مكتمل',
    '已完结', 'Tamamlandı', 'Đã hoàn thành', 'Завершено', 'Tamamlanan', 'Complété',
  ];

  protected readonly ongoingStatusList = [
    'OnGoing', 'Продолжается', 'Updating', 'Em Lançamento', 'Em lançamento',
    'Em andamento', 'Em Andamento', 'En cours', 'En Cours', 'En cours de publication',
    'Ativo', 'Lançando', 'Đang Tiến Hành', 'Còn Nữa', 'Devam Ediyor', 'Devam ediyor',
    'In Corso', 'In Arrivo', 'مستمرة', 'مستمر', 'En Curso', 'En curso', 'Emision',
    'Curso', 'En marcha', 'Publicandose', 'Publicándose', 'En emision', '连载中',
    'Devam Ediyo', 'Đang làm', 'Em postagem', 'Devam Eden', 'Em progresso',
    'Em curso', 'Atualizações Semanais',
  ];

  protected readonly hiatusStatusList = [
    'On Hold', 'Pausado', 'En espera', 'Durduruldu', 'Beklemede', 'Đang chờ',
    'متوقف', 'En Pause', 'Заморожено', 'En attente',
  ];

  protected readonly canceledStatusList = [
    'Canceled', 'Cancelado', 'İptal Edildi', 'Güncel', 'Đã hủy', 'ملغي',
    'Abandonné', 'Заброшено', 'Annulé',
  ];

  private loadMoreRequestDetected: LoadMoreDetection = 'Pending';
  private oldChapterEndpointDisabled = false;

  constructor(
    name: string,
    baseUrl: string,
    lang: string,
    protected readonly dateFormat = 'MMMM dd, yyyy',
  ) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  get mangaEntrySelector(): string {
    return this.filterNonMangaItems ? '.manga' : '';
  }

  protected popularMangaSelector(): string {
    return `${this.popularMangaSelectorStr}${this.mangaEntrySelector}`;
  }

  protected popularMangaNextPageSelector(): string | null {
    return this.useLoadMoreRequestInternal()
      ? 'body:not(:has(.no-posts))'
      : 'div.nav-previous, nav.navigation-ajax, a.nextpostslink';
  }

  protected searchMangaSelector(): string {
    return this.searchMangaSelectorStr;
  }

  protected searchMangaNextPageSelector(): string | null {
    return this.popularMangaNextPageSelector();
  }

  protected searchPage(page: number): string {
    return page === 1 ? '' : `page/${page}/`;
  }

  protected detectLoadMore($: CheerioAPI): void {
    if (
      this.useLoadMoreRequest === 'AutoDetect' &&
      this.loadMoreRequestDetected === 'Pending'
    ) {
      this.loadMoreRequestDetected = $('nav.navigation-ajax').length > 0
        ? 'True'
        : 'False';
    }
  }

  protected useLoadMoreRequestInternal(): boolean {
    switch (this.useLoadMoreRequest) {
      case 'Always': return true;
      case 'Never': return false;
      default: return this.loadMoreRequestDetected === 'True';
    }
  }

  protected async loadMoreRequest(page: number, popular: boolean): Promise<string> {
    const formData = new URLSearchParams();
    formData.append('action', 'madara_load_more');
    formData.append('page', String(page - 1));
    formData.append('template', 'madara-core/content/content-archive');
    formData.append('vars[orderby]', 'meta_value_num');
    formData.append('vars[paged]', '1');

    if (this.filterNonMangaItems) {
      formData.append('vars[meta_query][0][key]', '_wp_manga_chapter_type');
      formData.append('vars[meta_query][0][value]', 'manga');
    }

    formData.append('vars[post_type]', 'wp-manga');
    formData.append('vars[post_status]', 'publish');
    formData.append('vars[meta_key]', popular ? '_wp_manga_views' : '_latest_update');
    formData.append('vars[order]', 'desc');
    formData.append('vars[sidebar]', 'right');
    formData.append('vars[manga_archives_item_layout]', 'big_thumbnail');

    const res = await this.post(
      `${this.baseUrl}/wp-admin/admin-ajax.php`,
      formData,
      {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      },
    );
    return res.data;
  }

  protected async searchLoadMoreRequest(query: string, page: number): Promise<string> {
    const formData = new URLSearchParams();
    formData.append('action', 'madara_load_more');
    formData.append('page', String(page - 1));
    formData.append('template', 'madara-core/content/content-search');
    formData.append('vars[paged]', '1');
    formData.append('vars[template]', 'archive');
    formData.append('vars[sidebar]', 'right');
    formData.append('vars[post_type]', 'wp-manga');
    formData.append('vars[post_status]', 'publish');
    formData.append('vars[manga_archives_item_layout]', 'big_thumbnail');

    if (this.filterNonMangaItems) {
      formData.append('vars[meta_query][0][key]', '_wp_manga_chapter_type');
      formData.append('vars[meta_query][0][value]', 'manga');
    }

    formData.append('vars[s]', query);

    const res = await this.post(
      `${this.baseUrl}/wp-admin/admin-ajax.php`,
      formData,
      {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      },
    );
    return res.data;
  }

  protected imageFromElement(el: ReturnType<CheerioAPI>): string | null {
    if (el.attr('data-src')) return this.absUrl(el.attr('data-src')!);
    if (el.attr('data-lazy-src')) return this.absUrl(el.attr('data-lazy-src')!);
    if (el.attr('srcset')) return this.getSrcSetImage(el.attr('srcset')!);
    if (el.attr('data-cfsrc')) return this.absUrl(el.attr('data-cfsrc')!);
    if (el.attr('data-manga-src')) return this.absUrl(el.attr('data-manga-src')!);
    if (el.attr('src')) return this.absUrl(el.attr('src')!);
    return null;
  }

  protected getSrcSetImage(srcset: string): string | null {
    const urls = srcset.split(' ').filter(s => URL_REGEX.test(s));
    if (urls.length === 0) return null;
    return urls.reduce((a, b) => a > b ? a : b);
  }

  protected processThumbnail(url: string | null, _fromSearch = false): string | null {
    return url;
  }

  protected notUpdating(text: string): boolean {
    return !/Updating|Atualizando/i.test(text);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    let html: string;
    if (this.useLoadMoreRequestInternal()) {
      html = await this.loadMoreRequest(page, true);
    } else {
      const url = `${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?m_orderby=views`;
      const res = await this.get(url);
      html = res.data;
    }
    return this.popularMangaParse(html);
  }

  protected popularMangaParse(html: string): SearchResult {
    const $ = this.$(html);
    this.detectLoadMore($);

    const entries = $(this.popularMangaSelector()).toArray().map(el => {
      return this.popularMangaFromElement($(el));
    });

    const nextSelector = this.popularMangaNextPageSelector();
    const hasNextPage = nextSelector ? $(nextSelector).length > 0 : false;

    return { mangas: entries, hasNextPage };
  }

  protected popularMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    const urlEl = $el.find(this.popularMangaUrlSelector).first();
    const url = urlEl.length > 0 ? this.absUrl(urlEl.attr('href') || '') : '';
    const title = urlEl.length > 0 ? urlEl.text().trim() : '';

    const img = $el.find(this.popularMangaUrlSelectorImg).first();
    const thumbnailUrl = this.processThumbnail(this.imageFromElement(img), true) || '';

    return { title, url, thumbnailUrl, lang: this.lang };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    let html: string;
    if (this.useLoadMoreRequestInternal()) {
      html = await this.loadMoreRequest(page, false);
    } else {
      const url = `${this.baseUrl}/${this.mangaSubString}/${this.searchPage(page)}?m_orderby=latest`;
      const res = await this.get(url);
      html = res.data;
    }
    const result = this.popularMangaParse(html);
    const seen = new Set<string>();
    const mangas = result.mangas.filter(m => {
      if (seen.has(m.url)) return false;
      seen.add(m.url);
      return true;
    });
    return { mangas, hasNextPage: result.hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      try {
        const parsedUrl = new URL(query);
        const baseParsed = new URL(this.baseUrl);
        if (parsedUrl.host !== baseParsed.host) {
          throw new Error('Unsupported url');
        }
        const segments = parsedUrl.pathname.split('/').filter(Boolean);
        if (segments.length < 2) {
          throw new Error('Unsupported url');
        }
        return this.getSearch(`${URL_SEARCH_PREFIX}${segments[1]}`, page);
      } catch (err) {
        console.error(`Failed to parse URL in getSearch: ${err instanceof Error ? err.message : err}`);
        throw new Error('Unsupported url');
      }
    }

    if (query.startsWith(URL_SEARCH_PREFIX)) {
      const slug = query.substring(URL_SEARCH_PREFIX.length);
      const mangaUrl = `${this.baseUrl}/${this.mangaSubString}/${slug}/`;
      const mangaData = await this.getMangaDetails(mangaUrl);
      const manga: Manga = {
        title: mangaData.title || slug,
        url: mangaUrl,
        thumbnailUrl: mangaData.thumbnailUrl || '',
        lang: this.lang,
        author: mangaData.author,
        description: mangaData.description,
      };
      return { mangas: [manga], hasNextPage: false };
    }

    let html: string;
    if (this.useLoadMoreRequestInternal()) {
      html = await this.searchLoadMoreRequest(query, page);
    } else {
      const pagePath = this.searchPage(page);
      const searchUrl = pagePath
        ? `${this.baseUrl}/${pagePath}?s=${encodeURIComponent(query)}&post_type=wp-manga`
        : `${this.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
      const res = await this.get(searchUrl);
      html = res.data;
    }
    return this.searchMangaParse(html);
  }

  protected searchMangaParse(html: string): SearchResult {
    const $ = this.$(html);
    this.detectLoadMore($);

    const entries = $(this.searchMangaSelector()).toArray().map(el => {
      return this.searchMangaFromElement($(el));
    });

    const nextSelector = this.searchMangaNextPageSelector();
    const hasNextPage = nextSelector ? $(nextSelector).length > 0 : false;

    return { mangas: entries, hasNextPage };
  }

  protected searchMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    const urlEl = $el.find(this.searchMangaUrlSelector).first();
    const url = urlEl.length > 0 ? this.absUrl(urlEl.attr('href') || '') : '';
    const title = urlEl.length > 0 ? urlEl.text().trim() : '';

    const img = $el.find('img').first();
    const thumbnailUrl = this.processThumbnail(this.imageFromElement(img), true) || '';

    return { title, url, thumbnailUrl, lang: this.lang };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return this.mangaDetailsParse($, mangaUrl);
  }

  protected mangaDetailsParse($: CheerioAPI, mangaUrl: string): Partial<Manga> {
    const title = $(this.mangaDetailsSelectorTitle).first().text().trim();

    const author = $(this.mangaDetailsSelectorAuthor).toArray()
      .map(el => $(el).text().trim())
      .filter(t => this.notUpdating(t))
      .join(', ') || undefined;

    const descEl = $(this.mangaDetailsSelectorDescription).first();
    let description = '';
    if (descEl.length > 0) {
      const pEls = descEl.find('p');
      if (pEls.length > 0) {
        description = pEls.toArray().map(p => $(p).text().replace(/<br>/g, '\n')).join('\n\n');
      } else {
        description = descEl.text().trim();
      }
    }

    const thumbnail = $(this.mangaDetailsSelectorThumbnail).first();
    const thumbnailUrl = this.processThumbnail(this.imageFromElement(thumbnail)) || '';

    const genres = $(this.mangaDetailsSelectorGenre).toArray()
      .map(el => $(el).text().trim());

    $(this.mangaDetailsSelectorTag).toArray().forEach(el => {
      const text = $(el).text().trim();
      if (
        text.length <= 25 &&
        !text.toLowerCase().includes('read') &&
        !text.toLowerCase().includes(this.name.toLowerCase()) &&
        !text.toLowerCase().includes(this.name.replace(/ /g, '').toLowerCase()) &&
        !text.toLowerCase().includes(title.toLowerCase())
      ) {
        genres.push(text);
      }
    });

    const seriesTypeEl = $(this.seriesTypeSelector).first();
    const seriesType = seriesTypeEl.length > 0 ? seriesTypeEl.text().trim() : '';
    if (seriesType && this.notUpdating(seriesType) && seriesType !== '-') {
      genres.push(seriesType);
    }

    const altNameEl = $(this.altNameSelector).first();
    const altNameText = altNameEl.length > 0 ? altNameEl.text().trim() : '';
    if (altNameText && this.notUpdating(altNameText)) {
      const prefix = `${this.altName} `;
      description = description
        ? `${description}\n\n${prefix}${altNameText}`
        : `${prefix}${altNameText}`;
    }

    const manga: Partial<Manga> = {
      title,
      url: mangaUrl,
      thumbnailUrl,
      lang: this.lang,
    };

    if (author) manga.author = author;
    if (description) manga.description = description;

    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    let chapterElements = $(this.chapterListSelectorStr);

    if (chapterElements.length === 0) {
      const chaptersHolder = $('div[id^=manga-chapters-holder]');
      if (chaptersHolder.length > 0) {
        const mangaId = chaptersHolder.attr('data-id');
        let xhrHtml: string;

        if (this.useNewChapterEndpoint || this.oldChapterEndpointDisabled) {
          const xhrRes = await this.post(
            `${mangaUrl.replace(/\/$/, '')}/ajax/chapters`,
            null,
            { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
          );
          xhrHtml = xhrRes.data;
        } else {
          const formData = new URLSearchParams();
          formData.append('action', 'manga_get_chapters');
          formData.append('manga', mangaId || '');
          const xhrRes = await this.post(
            `${this.baseUrl}/wp-admin/admin-ajax.php`,
            formData,
            {
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
              validateStatus: (status: number) => status < 500,
            },
          );

          if (xhrRes.status === 400) {
            this.oldChapterEndpointDisabled = true;
            const xhrRes2 = await this.post(
              `${mangaUrl.replace(/\/$/, '')}/ajax/chapters`,
              null,
              { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
            );
            xhrHtml = xhrRes2.data;
          } else {
            xhrHtml = xhrRes.data;
          }
        }

        const xhr$ = this.$(xhrHtml);
        chapterElements = xhr$(this.chapterListSelectorStr);
      }
    }

    return chapterElements.toArray().map(el => this.chapterFromElement($(el)));
  }

  protected chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const urlEl = $el.find(this.chapterUrlSelector).first();
    let url = urlEl.length > 0
      ? this.absUrl(urlEl.attr('href') || '')
      : '';
    if (url) {
      url = url.split('?style=paged')[0];
      if (!url.endsWith(this.chapterUrlSuffix)) {
        url += this.chapterUrlSuffix;
      }
    }
    const name = urlEl.length > 0 ? urlEl.text().trim() : '';

    const imgAlt = $el.find('img:not(.thumb)').first().attr('alt');
    const spanTitle = $el.find('span a').first().attr('title');
    const dateText = $el.find(this.chapterDateSelectorStr).first().text();

    const dateUpload = imgAlt !== undefined
      ? this.parseRelativeDate(imgAlt)
      : spanTitle !== undefined
        ? this.parseRelativeDate(spanTitle)
        : this.parseChapterDate(dateText);

    return { name, url, dateUpload: dateUpload || undefined };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    return $(this.pageListParseSelector).toArray().map((el, index) => {
      const $el = $(el);
      const img = $el.is('img') ? $el : $el.find('img').first();
      const imageUrl = this.imageFromElement(img) || '';
      return { index, imageUrl };
    });
  }

  protected parseChapterDate(date: string | null | undefined): number {
    if (!date) return 0;
    const trimmed = date.trim();

    if (new WordSet(['yesterday', 'يوم واحد']).startsWith(trimmed)) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }

    if (new WordSet(['today']).startsWith(trimmed)) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }

    if (new WordSet(['يومين']).startsWith(trimmed)) {
      const d = new Date();
      d.setDate(d.getDate() - 2);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }

    if (new WordSet(['ago', 'atrás', 'önce', 'قبل', 'trước']).endsWith(trimmed)) {
      return this.parseRelativeDate(trimmed);
    }

    if (new WordSet(['hace', 'năm', 'tháng', 'tuần', 'ngày', 'giờ', 'phút', 'giây']).startsWith(trimmed)) {
      return this.parseRelativeDate(trimmed);
    }

    if (/\b\d+ jour/i.test(trimmed)) {
      return this.parseRelativeDate(trimmed);
    }

    if (/\d(st|nd|rd|th)/i.test(trimmed)) {
      const cleaned = trimmed.split(' ').map(part => {
        const m = part.match(/(\d+)(st|nd|rd|th)/i);
        return m ? m[1] : part;
      }).join(' ');
      return this.tryParseDate(cleaned);
    }

    return this.tryParseDate(trimmed);
  }

  private tryParseDate(dateStr: string): number {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  protected parseRelativeDate(date: string): number {
    const match = date.match(/(\d+)/);
    if (!match) return 0;
    const number = parseInt(match[1], 10);
    const now = new Date();
    const lower = date.toLowerCase();

    if (['hari', 'gün', 'jour', 'día', 'dia', 'day', 'วัน', 'ngày', 'giorni', 'أيام', '天'].some(w => lower.includes(w))) {
      now.setDate(now.getDate() - number);
    } else if (['jam', 'saat', 'heure', 'hora', 'hour', 'ชั่วโมง', 'giờ', 'ore', 'ساعة', '小时'].some(w => lower.includes(w))) {
      now.setHours(now.getHours() - number);
    } else if (['menit', 'dakika', 'min', 'minute', 'minuto', 'นาที', 'دقائق', 'phút'].some(w => lower.includes(w))) {
      now.setMinutes(now.getMinutes() - number);
    } else if (['detik', 'segundo', 'second', 'วินาที', 'giây'].some(w => lower.includes(w))) {
      now.setSeconds(now.getSeconds() - number);
    } else if (['week', 'semana', 'tuần'].some(w => lower.includes(w))) {
      now.setDate(now.getDate() - number * 7);
    } else if (['month', 'mes', 'tháng'].some(w => lower.includes(w))) {
      now.setMonth(now.getMonth() - number);
    } else if (['year', 'año', 'năm'].some(w => lower.includes(w))) {
      now.setFullYear(now.getFullYear() - number);
    } else {
      return 0;
    }

    return now.getTime();
  }
}
