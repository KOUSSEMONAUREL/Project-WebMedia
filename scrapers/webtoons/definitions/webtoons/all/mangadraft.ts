import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface MangaDraftCatalogProjectDto {
  name: string;
  avatar?: string | null;
  genres?: string | null;
  description?: string | null;
  url: string;
}

interface MangaDraftCatalogResponseDto {
  data: MangaDraftCatalogProjectDto[];
}

interface MangaDraftGenreDto {
  name: string;
}

interface MangaDraftProjectDto {
  name: string;
  description: string;
  genres: MangaDraftGenreDto[];
  project_status_id: number;
}

interface MangaDraftPageDto {
  id: number;
  number: number;
  url: string;
}

type PagesByCategory = Record<string, MangaDraftPageDto[]>;

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 0,
  fevrier: 1,
  février: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  août: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11,
  décembre: 11,
};

export class MangaDraftScraper extends BaseScraper {
  readonly name = 'MangaDraft';
  readonly baseUrl = 'https://mangadraft.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/catalog/projects`);
    url.searchParams.set('order', 'popular');
    url.searchParams.set('type', 'all');
    url.searchParams.set('page', String(page));
    url.searchParams.set('number', '20');
    return this.catalogParse(url.toString());
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/api/catalog/projects`);
    url.searchParams.set('order', 'news');
    url.searchParams.set('type', 'all');
    url.searchParams.set('page', String(page));
    url.searchParams.set('number', '20');
    return this.catalogParse(url.toString());
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    void query;
    const url = new URL(`${this.baseUrl}/api/catalog/projects`);
    url.searchParams.set('type', 'all');
    url.searchParams.set('order', 'all');
    url.searchParams.set('section', '');
    url.searchParams.set('genre', '');
    url.searchParams.set('format', '');
    url.searchParams.set('language', '');
    url.searchParams.set('status', '');
    url.searchParams.set('order_all', 'likes');
    url.searchParams.set('page', String(page));
    url.searchParams.set('number', '20');
    return this.catalogParse(url.toString());
  }

  private async catalogParse(url: string): Promise<SearchResult> {
    const response = await this.get(url);
    const result = response.data as MangaDraftCatalogResponseDto;
    const items = result.data ?? [];
    const mangas: Manga[] = items.map((it) => ({
      url: this.toPath(it.url),
      title: it.name,
      thumbnailUrl: it.avatar ?? '',
      lang: this.lang,
      description: it.description ?? undefined,
      genre: it.genres ?? undefined,
    }));
    return { mangas, hasNextPage: items.length >= 20 };
  }

  private toPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data as string);
    const scriptContent = $('script:contains("window.project")').first().html() ?? '';
    const match = scriptContent.match(/window\.project\s*=\s*(\{.*?\})\s*;/s);
    if (!match?.[1]) {
      throw new Error('MangaDraft: window.project not found');
    }
    const project = JSON.parse(match[1]) as MangaDraftProjectDto;
    return {
      title: project.name,
      description: project.description,
      author: $('[title="Auteur"]').text() || undefined,
      artist: $('[title="créateur"]').text() || undefined,
      genre: (project.genres ?? []).map((g) => g.name).join(', ') || undefined,
      status: this.parseStatus(project.project_status_id),
    };
  }

  private parseStatus(status: number | undefined): Manga['status'] {
    if (status === 0) return 1;
    if (status === 1) return 0;
    if (status === 2) return 2;
    return undefined;
  }

  // parse5 (et donc cheerio) range les enfants d'un <template> dans un
  // fragment separe que les selecteurs CSS n'atteignent pas, alors que
  // Jsoup -- et donc le selecteur upstream `div.mt-7 div a:not(:has(img))`
  // -- les expose comme descendants ordinaires. La liste des chapitres est
  // justement dans un <template v-if="sectionSelected === 'summary'">: sans
  // ce re-parse, getChapterList renvoie toujours 0 et getPageList devient
  // inatteignable. Le fragment ne contient plus l'ancetre `div.mt-7`, d'ou
  // le selecteur allonge ci-dessous, qui isole les liens de chapitre.
  private chapterScope(html: string): CheerioAPI {
    const $ = this.$(html);
    const templates = $('template').toArray();
    if (templates.length === 0) return $;
    return this.$(templates.map(el => $(el).html() ?? '').join(''));
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.chapterScope(response.data as string);
    const elements = $('div a:not(:has(img))').toArray();
    if (elements.length === 0) {
      return [];
    }
    const isNotOneShot = ($(elements[0]).attr('href') ?? '').includes('c.');
    if (!isNotOneShot) {
      return [this.chapterFromElement($, elements[0], 0)];
    }
    return elements
      .map((el, i) => this.chapterFromElement($, el, i))
      .reverse();
  }

  private chapterFromElement(
    $: ReturnType<BaseScraper['$']>,
    el: unknown,
    index: number,
  ): Chapter {
    const $el = $(el as Parameters<ReturnType<BaseScraper['$']>>[0]);
    // Le HTML est indente sur plusieurs lignes: sans trim, chaque nom de
    // chapitre embarque des sauts de ligne et l'indentation du template.
    const title = $el.find('.group-hover\\:text-secondary').first().text().trim();
    let name = `${index.toFixed(1)}. ${title}`;
    const dateText = $el.find('div>span').first().text().trim();
    let dateUpload: number | undefined;
    if (dateText) {
      name = name.split(dateText)[0];
      dateUpload = this.parseFrenchDate(dateText);
    }
    return {
      url: this.absUrl($el.attr('href') ?? ''),
      name: name.trim(),
      chapterNumber: index,
      dateUpload,
    };
  }

  private parseFrenchDate(text: string): number | undefined {
    const parts = text.split(' ');
    if (parts.length !== 3) return undefined;
    const day = parseInt(parts[0], 10);
    const month = FRENCH_MONTHS[parts[1].toLowerCase()];
    const year = parseInt(parts[2], 10);
    if (Number.isNaN(day) || month === undefined || Number.isNaN(year)) return undefined;
    return Date.UTC(year, month, day);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    let firstPage: string;
    if (chapterUrl.includes('c.')) {
      const response = await this.get(chapterUrl);
      const finalUrl =
        (response.request as { res?: { responseUrl?: string } })?.res?.responseUrl ?? chapterUrl;
      firstPage = (finalUrl.split('/').pop() ?? '').replace(/\D/g, '');
    } else {
      firstPage = (chapterUrl.split('/').pop() ?? '').replace(/\D/g, '');
    }
    const response = await this.get(
      `${this.baseUrl}/api/reader/listPages?first_page=${firstPage}&grouped_by_category=true`,
    );
    const result = response.data as PagesByCategory;
    const pageId = Number(firstPage);
    const pageList = Object.values(result).find((list) => list.some((p) => p.id === pageId));
    if (!pageList) {
      throw new Error(`MangaDraft: no page category found for first_page=${firstPage}`);
    }
    return pageList.map((p) => ({
      index: p.number,
      imageUrl: `${p.url}?size=full`,
    }));
  }
}
