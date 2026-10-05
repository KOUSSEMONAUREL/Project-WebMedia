import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

// Transcompilation of keiyoushi src/en/comichubfree (ComicHubFree.kt,
// KeiSource, libVersion 1.6). HTML directory site: popular/latest/search
// share one list layout (`.movie-list-index > .cartoon-box`), details live
// under `div.movie-info`, chapters paginate via `ul.pagination a[rel=next]`,
function pickImage($img: { attr(name: string): string | undefined }): string {
  return $img.attr('data-src') ?? $img.attr('src') ?? '';
}

function parseEnglishDate(value: string): number | undefined {
  // Upstream `DateTimeFormatter.ofPattern("d-MMM-yyyy", Locale.ENGLISH)`.
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const match = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(value.trim());
  if (!match) return undefined;
  const month = months[match[2].toLowerCase()];
  if (month === undefined) return undefined;
  return Date.UTC(Number(match[3]), month, Number(match[1]));
}

export class ComichubfreeScraper extends BaseScraper {
  readonly name = 'ComicHubFree';
  readonly baseUrl = 'https://comichubfree.com';
  readonly lang = 'en';

  private parsePopular(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.movie-list-index > .cartoon-box:has(.detail)').each((_i, element) => {
      const $el = $(element);
      const href = $el.find('a').first().attr('href') ?? '';
      const title = $el.find('h3').first().text().trim();
      if (!href || !title) return;
      mangas.push({
        title,
        url: this.absUrl(href).replace(this.baseUrl, ''),
        thumbnailUrl: this.absUrl(pickImage($el.find('img').first())),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('ul.pagination a[rel=next]:not(hidden)').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/popular-comic?page=${page}`);
    return this.parsePopular(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/new-comic?page=${page}`);
    return this.parsePopular(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({ key: query.trim(), page: String(page) });
    const res = await this.get(`${this.baseUrl}/search-comic?${params.toString()}`);
    return this.parsePopular(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const info = $('div.movie-info').first();
    if (info.length === 0) return { url: mangaUrl, lang: this.lang };
    const seriesInfo = info.find('div.series-info').first();
    const textOf = (label: string): string => {
      const dd = seriesInfo.find(`dt:contains("${label}") + dd`).first();
      return dd.text().trim();
    };
    const status = textOf('Status:');
    // The `h1` is an SEO string ("Read <Title> Comics Online for Free");
    // upstream leaves the title unset in parseDetails (the listing title
    // stands), so unwrap the site wrapper instead of storing the SEO text.
    const rawTitle = $('h1').first().text().trim();
    const seoMatch = /^Read\s+(.+?)\s+Comics Online for Free$/i.exec(rawTitle);
    return {
      title: (seoMatch?.[1] ?? rawTitle) || undefined,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(pickImage(seriesInfo.find('img').first())),
      description: info.find('div#film-content').first().text().trim() || undefined,
      author: textOf('Authors:') || undefined,
      genre: undefined,
      status: status === 'Ongoing' ? 1 : status === 'Completed' ? 0 : 3,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    let nextUrl: string | null = mangaUrl;
    while (nextUrl) {
      const res = await this.get(nextUrl);
      const $ = this.$(res.data);
      $('div.episode-list > div > table > tbody > tr').each((_i, element) => {
        const $el = $(element);
        const link = $el.find('a').first();
        const href = link.attr('href') ?? '';
        if (!href) return;
        const dateText = $el.find('td').last().text().trim();
        chapters.push({
          name: link.text().trim(),
          url: this.absUrl(href).replace(this.baseUrl, ''),
          dateUpload: parseEnglishDate(dateText),
        });
      });
      const next = $('ul.pagination a[rel=next]:not(hidden)').first().attr('href');
      nextUrl = next ? this.absUrl(next) : null;
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${chapterUrl.replace(/\/$/, '')}/all`);
    const $ = this.$(res.data);
    const seen = new Set<string>();
    const pages: Page[] = [];
    $('img.chapter_img').each((_i, element) => {
      const imageUrl = this.absUrl(pickImage($(element)));
      if (!imageUrl || seen.has(imageUrl)) return;
      seen.add(imageUrl);
      pages.push({ index: pages.length, imageUrl });
    });
    return pages;
  }
}
