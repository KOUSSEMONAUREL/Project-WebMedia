import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const ORDINAL_REGEX = /(?<=\d)(st|nd|rd|th)|,/g;
const DATE_REGEX_1 = /\d{1,2}\s?\w{3,9}\s?\w{2,4}/;
const DATE_REGEX_2 = /\w{3,9}\s?\d{1,2}\s?\d{2,4}/;
const DOT_DATE_REGEX = /\d{1,2}\.\d{1,2}\.\d{4}/;

export class ComicFuryScraper extends BaseScraper {
  readonly name = 'Comic Fury';
  readonly baseUrl = 'https://comicfury.com';
  readonly lang = 'all';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this._search(query, page, 0);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this._search('', page, 1);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this._search('', page, 2);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const urlObj = new URL(mangaUrl);
    const slug = urlObj.searchParams.get('url') || '';
    const detailsUrl = slug ? `${this.baseUrl}/read/${slug}/archive` : mangaUrl;

    const res = await this.get(detailsUrl);
    const $ = this.$(res.data);

    const desDiv = $('div.description-tags').first();
    let description: string | undefined;
    let genre: string | undefined;

    if (desDiv.length > 0) {
      const parent = desDiv.parent();
      if (parent) {
        const cloned = parent.clone();
        cloned.children().remove();
        description = cloned.text().trim() || undefined;
      }
      genre = [...$(desDiv).children()].map(el => $(el).text()).join(', ') || undefined;
    } else {
      description = $('div.username-and-title em').first().text() || undefined;
      genre = [...$('div.authorinfo:contains(Genre) a')].map(el => $(el).text()).join(', ') || undefined;
    }

    const author = [...$('a.authorname')].map(el => $(el).text()).join(', ') || undefined;

    return {
      url: mangaUrl,
      description,
      author,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const urlObj = new URL(mangaUrl);
    const slug = urlObj.searchParams.get('url') || '';
    const archiveUrl = slug ? `${this.baseUrl}/read/${slug}/archive` : mangaUrl;

    const chapters: Chapter[] = [];

    const chapterSelector = 'a:has(div.archive-comic)';
    const nextPageSelector = 'span.vfpagecurrent + a.vfpage';

    const collectFromPage = async (pageUrl: string, chapterHeader?: string) => {
      let currentUrl = pageUrl;
      while (currentUrl) {
        const res = await this.get(currentUrl);
        const $ = this.$(res.data);

        $(chapterSelector).each((_i: number, el: any) => {
          const $el = $(el);
          const comicName = $el.find('.archive-comic-title').text();
          chapters.push({
            name: chapterHeader ? `${chapterHeader} - ${comicName}` : comicName,
            url: this.absUrl($el.attr('href') || ''),
            dateUpload: this._toDate($el.find('.archive-comic-date').text()),
          });
        });

        const nextBtn = $(nextPageSelector).first();
        currentUrl = nextBtn.length > 0 ? this.absUrl(nextBtn.attr('href') || '') : '';
      }
    };

    const res = await this.get(archiveUrl);
    const $ = this.$(res.data);

    const archiveSelector = 'a:has(div.archive-chapter)';
    const archiveEls = $(archiveSelector);
    if (archiveEls.length > 0) {
      for (const el of [...archiveEls]) {
        const $el = $(el);
        const archivePageUrl = this.absUrl($el.attr('href') || '');
        const chapterHeader = $el.find('.archive-chapter-title').text() || $el.text();
        await collectFromPage(archivePageUrl, chapterHeader);
      }
    } else {
      await collectFromPage(archiveUrl);
    }

    // Fallback for custom layout (infinite scroll disabled)
    if (chapters.length === 0 && slug) {
      try {
        const customUrl = `https://${slug}.webcomic.ws/archive/comics`;
        const fallbackRes = await this.get(customUrl);
        const $fallback = this.$(fallbackRes.data);

        $fallback('div.archivecomic, div.nl-archivecomic').each((_i: number, el: any) => {
          const $el = $(el);
          const linkEl = $el.find('a').first();
          if (linkEl.length === 0) return;
          const chapterHeader = $el.parent().prev().find('h3').first().text();
          const comicName = linkEl.text();
          chapters.push({
            name: chapterHeader ? `${chapterHeader} - ${comicName}` : comicName,
            url: this.absUrl(linkEl.attr('href') || ''),
            dateUpload: this._toDate(
              $el.find('.comicposttime, .nl-archivecomicposttime').first().text(),
            ),
          });
        });
      } catch (err) {
        console.error(`ComicFury fallback chapter parsing error: ${err instanceof Error ? err.message : err}`);
      }
    }

    return chapters.map((ch, i) => ({ ...ch })).reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];

    const comicPage = $('div.is--comic-page').first();
    if (comicPage.length > 0) {
      // Infinite Scroll layout (default)
      $(comicPage).find('div.is--image-segment div img').each((_i: number, el: any) => {
        pages.push({ index: pages.length, imageUrl: this.absUrl($(el).attr('src') || '') });
      });
    } else {
      // Custom layout fallback
      $('#comicimage').each((_i: number, el: any) => {
        pages.push({ index: pages.length, imageUrl: this.absUrl($(el).attr('src') || '') });
      });
    }

    return pages;
  }

  private async _search(query: string, page: number, sort: number): Promise<SearchResult> {
    const req = new URL(`${this.baseUrl}/search.php`);
    req.searchParams.set('query', query);
    req.searchParams.set('page', String(page));
    req.searchParams.set('language', 'all');
    req.searchParams.set('sort', String(sort));
    req.searchParams.set('completed', '1');
    req.searchParams.set('lastupdate', '0');
    req.searchParams.set('fv', '0');
    req.searchParams.set('fn', '0');
    req.searchParams.set('fl', '0');
    req.searchParams.set('fs', '0');

    const res = await this.get(req.toString());
    const $ = this.$(res.data);
    const mangas: Manga[] = [];

    $('div.webcomic-result').each((_i: number, el: any) => {
      const $el = $(el);
      const link = $el.find('div.webcomic-result-avatar a').first();
      const titleEl = $el.find('div.webcomic-result-title').first();
      const img = $el.find('div.webcomic-result-avatar a img').first();
      mangas.push({
        title: titleEl.attr('title') || '',
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      });
    });

    const hasNextPage = $('div.search-next-page').length > 0;
    return { mangas, hasNextPage };
  }

  private _toDate(dateStr: string): number | undefined {
    const cleaned = dateStr.replace(ORDINAL_REGEX, '').trim();
    if (!cleaned) return undefined;

    const dotMatch = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotMatch) {
      const d = new Date(parseInt(dotMatch[3]), parseInt(dotMatch[2]) - 1, parseInt(dotMatch[1]));
      return isNaN(d.getTime()) ? undefined : d.getTime();
    }

    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }
}
