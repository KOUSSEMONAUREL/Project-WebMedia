import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

// Transcompilation of the Shonen Jump service of keiyoushi `en/vizshonenjump`
// (Viz.kt). The catalogue and the series pages are served over plain HTTP;
// the chapter reader itself requires a VIZ account/subscription.

const SERVICE_PATH = 'shonenjump';
const SEARCH_CATEGORY = 'SjChapterSeries';

function parseVizDate(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export class VizShonenJumpScraper extends BaseScraper {
  readonly name = 'VIZ';
  readonly baseUrl = 'https://www.viz.com';
  readonly lang = 'en';

  private slugFrom(url: string): string {
    try {
      return new URL(url, this.baseUrl).pathname.split('/').filter(Boolean).pop() ?? '';
    } catch {
      return '';
    }
  }

  private async listing(section: string): Promise<SearchResult> {
    const res = await this.get(`/manga-books/${SERVICE_PATH}/section/${section}`);
    const $ = this.$(String(res.data));
    const cards: Array<{ rank: number; manga: Manga }> = [];

    $('div.o_sortable > a.o_chapters-link').each((_index, element) => {
      const $element = $(element);
      const title = $element.find('div.pad-x-rg').first().text().trim();
      const href = $element.attr('href') ?? '';
      const slug = this.slugFrom(href);
      if (!title || !slug) return;
      const rank = Number.parseInt($element.parent().attr('data-sort-recent') ?? '', 10);
      cards.push({
        rank: Number.isNaN(rank) ? 0 : rank,
        manga: {
          title,
          url: `/${SERVICE_PATH}/chapters/${slug}`,
          thumbnailUrl: this.absUrl($element.find('div.pos-r img.disp-bl').first().attr('data-original') ?? ''),
          lang: this.lang,
        },
      });
    });

    cards.sort((a, b) => a.rank - b.rank);
    return { mangas: cards.map(card => card.manga), hasNextPage: false };
  }

  async getPopular(): Promise<SearchResult> {
    return this.listing('trending-manga');
  }

  async getLatest(): Promise<SearchResult> {
    return this.listing('free-chapters');
  }

  async getSearch(query: string): Promise<SearchResult> {
    const term = query.trim();
    const params = new URLSearchParams({ search: term, category: SEARCH_CATEGORY });
    const res = await this.get(`/search?${params.toString()}`);
    const $ = this.$(String(res.data));
    const mangas: Manga[] = [];

    $('div.p-cs-tile a.o_property-link').each((_index, element) => {
      const $element = $(element);
      const title = $element.find('div.pad-x-rg').first().text().trim();
      const href = $element.attr('href') ?? '';
      if (!title || !href.includes(`/${SERVICE_PATH}/chapters/`)) return;
      if (term && !title.toLowerCase().includes(term.toLowerCase())) return;
      mangas.push({
        title,
        url: `/${SERVICE_PATH}/chapters/${this.slugFrom(href)}`,
        thumbnailUrl: this.absUrl($element.find('div.pos-r img.disp-bl').first().attr('data-original') ?? ''),
        lang: this.lang,
      });
    });

    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFrom(mangaUrl);
    if (!slug) return { url: mangaUrl, lang: this.lang };
    const res = await this.get(`/${SERVICE_PATH}/chapters/${slug}`);
    const $ = this.$(String(res.data));
    const intro = $('section#series-intro').first();
    const title = intro.find('h2').first().text().trim() || slug;
    const author = intro.find('span.disp-bl--bm').first().text().trim().replace(/^Created by\s+/i, '');
    const description = intro.find('h2').first().next('div').first().text().trim();
    const thumbnail =
      $('meta[property="og:image"]').attr('content') ??
      $('section.section_chapters td a > img').first().attr('data-original') ??
      '';

    return {
      title,
      url: `/${SERVICE_PATH}/chapters/${slug}`,
      thumbnailUrl: this.absUrl(thumbnail),
      author: author || undefined,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFrom(mangaUrl);
    if (!slug) return [];
    const res = await this.get(`/${SERVICE_PATH}/chapters/${slug}`);
    const $ = this.$(String(res.data));
    const chapters: Chapter[] = [];

    $('section.section_chapters a.o_chapter-container[id^="ch-"]').each((_index, element) => {
      const $element = $(element);
      const target = $element.attr('data-target-url') ?? '';
      if (!target) return;

      const locked = target.startsWith('javascript');
      let path = target;
      if (locked) {
        const match = /tryReadChapter\(\d+,\s*'([^']+)'/.exec(target);
        path = match?.[1] ?? '';
      }
      if (!path) return;

      const dateTable = $element.children('div').first().find('table');
      const baseName = dateTable.length > 0
        ? $element.children('div').eq(1).find('td').first().text().trim() || 'Oneshot'
        : $element.text().trim();
      if (!baseName) return;

      const numberMatch = /(?:Ch\.|Chapter)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(baseName);
      const chapterNumber = numberMatch ? Number.parseFloat(numberMatch[1]) : -1;
      const dateText = dateTable.find('td[align="right"], td > span').first().text().trim();

      chapters.push({
        name: locked ? `[Locked] ${baseName}` : baseName,
        url: this.absUrl(path),
        chapterNumber: Number.isNaN(chapterNumber) ? -1 : chapterNumber,
        dateUpload: dateText ? parseVizDate(dateText) : undefined,
      });
    });

    return chapters.sort((a, b) => (b.chapterNumber ?? -1) - (a.chapterNumber ?? -1));
  }

  async getPageList(): Promise<Page[]> {
    // VIZ serves chapter images only to a logged-in subscriber. The webtoon
    // pipeline ingests the series URL and never consumes page images.
    return [];
  }
}

export default VizShonenJumpScraper;
