import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

const URL_SEARCH_PREFIX = 'url:';
const MANGA_PAGE_ID_REGEX = /post_id\s*:\s*(\d+)\}/;
const CHAPTER_PAGE_ID_REGEX = /chapter_id\s*=\s*(\d+);/;
const JSON_IMAGE_LIST_REGEX = /"images"\s*:\s*(\[.*?\])/;

function selector(template: string, contains: string[]): string {
  return contains.map(s => template.replace('%s', s)).join(', ');
}

export abstract class MangaThemesiaScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;
  protected readonly mangaUrlDirectory: string;
  protected readonly dateFormat: string;
  protected sendViewCount = true;

  constructor(
    name: string,
    baseUrl: string,
    lang: string,
    mangaUrlDirectory = '/manga',
    dateFormat = 'MMMM dd, yyyy',
  ) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
    this.mangaUrlDirectory = mangaUrlDirectory;
    this.dateFormat = dateFormat;
  }

  protected get seriesDetailsSelector(): string {
    return 'div.bigcontent, div.animefull, div.main-info, div.postbody';
  }

  protected get seriesTitleSelector(): string {
    return 'h1.entry-title, .ts-breadcrumb li:last-child span';
  }

  protected get seriesArtistSelector(): string {
    return selector(
      '.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span, span:contains(%s)',
      ['artist', 'Artiste', 'Artista', '\u0627\u0644\u0631\u0633\u0627\u0645', '\u0627\u0644\u0646\u0627\u0634\u0631', '\u0130ll\u00fcstrat\u00f6r', '\u00c7izer', 'Sanat\u00e7\u0131'],
    );
  }

  protected get seriesAuthorSelector(): string {
    return selector(
      '.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span, span:contains(%s)',
      ['Author', 'Auteur', 'autor', '\u0627\u0644\u0645\u0624\u0644\u0641', 'Mangaka', 'seniman', 'Pengarang', 'Yazar'],
    );
  }

  protected get seriesDescriptionSelector(): string {
    return '.desc, .entry-content[itemprop=description]';
  }

  protected get seriesAltNameSelector(): string {
    return '.alternative, .wd-full:contains(alt) span, .alter, .seriestualt, ' +
      selector(
        '.infotable tr:contains(%s) td:last-child',
        ['Alternative', 'Alternatif', '\u0627\u0644\u0623\u0633\u0645\u0627\u0621 \u0627\u0644\u062b\u0627\u0646\u0648\u064a\u0629'],
      );
  }

  protected get seriesGenreSelector(): string {
    return 'div.gnr a, .mgen a, .seriestugenre a, ' +
      selector(
        'span:contains(%s)',
        ['genre', '\u0627\u0644\u062a\u0635\u0646\u064a\u0641'],
      );
  }

  protected get seriesTypeSelector(): string {
    return selector(
      '.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .tsinfo .imptdt:contains(%s) a, .fmed b:contains(%s)+span, span:contains(%s) a',
      ['type', '\u0e1b\u0e23\u0e30\u0e40\u0e20\u0e17', '\u0627\u0644\u0646\u0648\u0639', 'tipe', 'T\u00fcr\u00fc'],
    ) + ', a[href*=type\\=]';
  }

  protected get seriesStatusSelector(): string {
    return selector(
      '.infotable tr:contains(%s) td:last-child, .tsinfo .imptdt:contains(%s) i, .fmed b:contains(%s)+span span:contains(%s)',
      ['status', 'Statut', 'Durum', '\u9023\u8f09\u72c0\u6cc1', 'Estado', '\u0627\u0644\u062d\u0627\u0644\u0629', '\u062d\u0627\u0644\u0629 \u0627\u0644\u0639\u0645\u0644', '\u0e2a\u0e16\u0e32\u0e19\u0e30', 'stato', 'Stat\u00fcs\u00fc'],
    );
  }

  protected get seriesThumbnailSelector(): string {
    return '.infomanga > div[itemprop=image] img, .thumb img';
  }

  protected get altNamePrefix(): string {
    return 'Alternative: ';
  }

  protected searchMangaSelector(): string {
    return '.utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx';
  }

  protected searchMangaNextPageSelector(): string | null {
    return 'div.pagination .next, div.hpage .r';
  }

  protected chapterListSelector(): string {
    return 'div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)';
  }

  protected chapterDateSelector(): string {
    return '.chapterdate';
  }

  protected get pageSelector(): string {
    return 'div#readerarea img';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const html = await this.searchMangaFetch(page, '', 'popular');
    return this.searchMangaParse(html);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const html = await this.searchMangaFetch(page, '', 'update');
    return this.searchMangaParse(html);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      return this.getSearch(`${URL_SEARCH_PREFIX}${query}`, page);
    }

    if (query.startsWith(URL_SEARCH_PREFIX)) {
      const urlString = query.substring(URL_SEARCH_PREFIX.length);
      const mangaUrl = await this.resolveMangaUrl(urlString);
      if (!mangaUrl) {
        return { mangas: [], hasNextPage: false };
      }
      const mangaData = await this.getMangaDetails(mangaUrl);
      const manga: Manga = {
        title: mangaData.title || '',
        url: mangaUrl,
        thumbnailUrl: mangaData.thumbnailUrl || '',
        lang: this.lang,
        author: mangaData.author,
        description: mangaData.description,
      };
      return { mangas: [manga], hasNextPage: false };
    }

    const html = await this.searchMangaFetch(page, query, '');
    return this.searchMangaParse(html);
  }

  private async resolveMangaUrl(urlString: string): Promise<string | null> {
    const baseMangaUrl = `${this.baseUrl}${this.mangaUrlDirectory}`;
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      console.error(`Failed to parse URL ${urlString} on ${this.name}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
    const baseParsed = new URL(baseMangaUrl);
    if (parsed.host !== baseParsed.host) return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    const baseSegments = baseParsed.pathname.split('/').filter(Boolean);

    if (segments.length === 2 && segments[0] === baseSegments[0]) {
      return `${baseMangaUrl}/${segments[1]}/`;
    }

    if (segments.length === 1 || (segments.length === 2 && segments[1] === '')) {
      try {
        const res = await this.get(urlString);
        const $ = this.$(res.data);
        const links = $('a[itemprop=item]');
        if (links.length === 3) {
          const newUrl = this.absUrl($(links[1]).attr('href') || '');
          const newParsed = new URL(newUrl);
          if (newParsed.host === baseParsed.host) {
            const newSegments = newParsed.pathname.split('/').filter(Boolean);
            if (newSegments.length === 2 && newSegments[0] === baseSegments[0]) {
              return `${baseMangaUrl}/${newSegments[1]}/`;
            }
          }
        }
      } catch (err) {
        console.error(`Failed to resolve manga URL from ${urlString} on ${this.name}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }

    return null;
  }

  protected async searchMangaFetch(page: number, query: string, order: string): Promise<string> {
    const params = new URLSearchParams();
    if (query) params.set('title', query);
    params.set('page', String(page));
    if (order) params.set('order', order);
    const url = `${this.baseUrl}${this.mangaUrlDirectory}?${params.toString()}`;
    const res = await this.get(url);
    return res.data;
  }

  protected searchMangaParse(html: string): SearchResult {
    const $ = this.$(html);
    const mangas = $(this.searchMangaSelector()).toArray().map(el => {
      return this.searchMangaFromElement($(el));
    });
    const nextSelector = this.searchMangaNextPageSelector();
    const hasNextPage = nextSelector ? $(nextSelector).length > 0 : false;
    return { mangas, hasNextPage };
  }

  protected searchMangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    const a = $el.find('a').first();
    const url = a.length > 0 ? this.absUrl(a.attr('href') || '') : '';
    const title = a.attr('title') || '';
    const img = $el.find('img').first();
    const thumbnailUrl = this.imageAttr(img) || '';
    return { title, url, thumbnailUrl, lang: this.lang };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return this.mangaDetailsParse($, mangaUrl);
  }

  protected mangaDetailsParse($: CheerioAPI, mangaUrl: string): Partial<Manga> {
    const seriesDetails = $(this.seriesDetailsSelector).first();

    const title = seriesDetails.length > 0
      ? seriesDetails.find(this.seriesTitleSelector).first().text().trim()
      : '';

    const artistEl = seriesDetails.find(this.seriesArtistSelector).first();
    const artist = this.cleanText(seriesDetails.length > 0 ? seriesDetails.find(this.seriesArtistSelector).first().text().trim() : null);

    const authorEl = seriesDetails.find(this.seriesAuthorSelector).first();
    let author = this.cleanText(seriesDetails.length > 0 ? seriesDetails.find(this.seriesAuthorSelector).first().text().trim() : null);

    let description = seriesDetails.length > 0
      ? seriesDetails.find(this.seriesDescriptionSelector).toArray()
          .map(el => $(el).text().trim())
          .filter(Boolean)
          .join('\n')
      : '';

    const altNameEl = seriesDetails.find(this.seriesAltNameSelector).first();
    const altName = this.cleanText(altNameEl.length > 0 ? altNameEl.text().trim() : null);
    if (altName) {
      description = description
        ? `${description}\n\n${this.altNamePrefix}${altName}`
        : `${this.altNamePrefix}${altName}`;
    }

    const genres: string[] = [];
    seriesDetails.find(this.seriesGenreSelector).toArray().forEach(el => {
      const text = $(el).text().trim();
      if (text) genres.push(text);
    });

    const typeEl = seriesDetails.find(this.seriesTypeSelector).first();
    const seriesType = this.cleanText(typeEl.length > 0 ? typeEl.text().trim() : null);
    if (seriesType) {
      genres.push(seriesType);
    }

    const status = seriesDetails.length > 0 ? seriesDetails.find(this.seriesStatusSelector).first().text().trim() : '';

    const thumbnail = seriesDetails.find(this.seriesThumbnailSelector).first();
    const thumbnailUrl = this.imageAttr(thumbnail) || '';

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

  protected cleanText(text: string | null | undefined): string | null {
    if (!text) return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed === '-' || trimmed === 'N/A' || trimmed === 'n/a' || trimmed === 'Unknown') return null;
    return trimmed;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    this.countViews($, mangaUrl);

    const chapters = $(this.chapterListSelector()).toArray().map(el => {
      return this.chapterFromElement($(el));
    });

    if (chapters.length > 0 && chapters[0].dateUpload === undefined) {
      const dateEl = $('.listinfo time[itemprop=dateModified], .fmed:contains(update) time, span:contains(update) time');
      const dateStr = dateEl.attr('datetime') || '';
      if (dateStr) {
        const parsed = this.parseDate(dateStr, 'yyyy-MM-dd');
        chapters[0].dateUpload = parsed || undefined;
      }
    }

    if (chapters.length === 0) {
      const chaptersHolder = $('div[id^=manga-chapters-holder]');
      if (chaptersHolder.length > 0) {
        const xhrRes = await this.post(
          `${mangaUrl.replace(/\/$/, '')}/ajax/chapters`,
          null,
          { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
        );
        const xhr$ = this.$(xhrRes.data);
        return xhr$(this.chapterListSelector()).toArray().map(el => {
          return this.chapterFromElement($(el));
        });
      }
    }

    return chapters;
  }

  protected chapterFromElement($el: ReturnType<CheerioAPI>): Chapter {
    const urlElements = $el.find('a');
    const url = urlElements.length > 0 ? this.absUrl(urlElements.first().attr('href') || '') : '';
    const name = $el.find('.lch a, .chapternum').text().trim() ||
      (urlElements.length > 0 ? urlElements.first().text().trim() : '');
    const dateText = $el.find(this.chapterDateSelector()).first().text().trim();
    const dateUpload = this.parseChapterDate(dateText) || undefined;
    return { name, url, dateUpload };
  }

  protected parseChapterDate(date: string | null): number {
    if (!date) return 0;
    const trimmed = date.trim();
    if (!trimmed) return 0;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.getTime();
    return 0;
  }

  protected parseDate(dateStr: string, _format: string): number {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    this.countViews($, chapterUrl);

    const htmlPages = $(this.pageSelector).toArray()
      .map(el => this.imageAttr($(el)))
      .filter(Boolean)
      .map((imgUrl, i) => ({
        index: i,
        imageUrl: imgUrl!,
      }));

    if (htmlPages.length > 0) return htmlPages;

    const docString = $.html();
    const match = JSON_IMAGE_LIST_REGEX.exec(docString);
    if (match && match[1]) {
      try {
        const imageList = JSON.parse(match[1]) as string[];
        return imageList.map((imgUrl, i) => ({
          index: i,
          imageUrl: imgUrl,
        }));
      } catch (err) {
        console.error(`Failed to parse JSON image list on ${this.name}: ${err instanceof Error ? err.message : err}`);
        return [];
      }
    }

    return [];
  }

  protected imageAttr($el: ReturnType<CheerioAPI>): string | null {
    if ($el.attr('data-lazy-src')) return this.absUrl($el.attr('data-lazy-src')!);
    if ($el.attr('data-src')) return this.absUrl($el.attr('data-src')!);
    if ($el.attr('data-cfsrc')) return this.absUrl($el.attr('data-cfsrc')!);
    if ($el.attr('src')) return this.absUrl($el.attr('src')!);
    return null;
  }

  protected countViews($: CheerioAPI, location: string): void {
    if (!this.sendViewCount) return;

    const scriptContent = $('script:contains(dynamic_view_ajax)').first().text();
    if (!scriptContent) return;

    const chapterMatch = CHAPTER_PAGE_ID_REGEX.exec(scriptContent);
    const mangaMatch = MANGA_PAGE_ID_REGEX.exec(scriptContent);
    const postId = chapterMatch?.[1] || mangaMatch?.[1];
    if (!postId) return;

    const formData = new URLSearchParams();
    formData.append('action', 'dynamic_view_ajax');
    formData.append('post_id', postId);

    this.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, formData, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: location,
      },
    }).catch(() => {});
  }
}
