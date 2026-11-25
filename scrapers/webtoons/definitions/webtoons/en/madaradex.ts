import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

function parseStatus(value: string): MangaStatus {
  switch (value.trim().toLowerCase()) {
    case 'completed':
    case 'complete':
      return 0;
    case 'ongoing':
    case 'on-going':
      return 1;
    case 'cancelled':
    case 'canceled':
    case 'dropped':
      return 2;
    case 'on hold':
    case 'hiatus':
      return 3;
    default:
      return undefined;
  }
}

export class MadaradexScraper extends BaseScraper {
  readonly name = 'MadaraDex';
  readonly baseUrl = 'https://madaradex.org';
  readonly lang = 'en';

  private archiveUrl(page: number, order: string): string {
    const pagePath = page > 1 ? `page/${page}/` : '';
    return `${this.baseUrl}/all/${pagePath}?m_orderby=${order}`;
  }

  private parseCards(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('article.mdxr-card').each((_, element) => {
      const card = $(element);
      const link = card.find('h3 a').first();
      const url = (link.attr('href') ?? '').trim();
      const title = link.text().trim();
      if (!url || !title) return;
      const image = card.find('img').first();
      const thumbnail = (image.attr('data-src') ?? image.attr('src') ?? '').trim();
      mangas.push({
        title,
        url: this.absUrl(url),
        thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('a[rel=next]').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.archiveUrl(page, 'popular'));
    return this.parseCards(String(res.data));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.archiveUrl(page, 'latest'));
    return this.parseCards(String(res.data));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const pagePath = page > 1 ? `page/${page}/` : '';
    const params = new URLSearchParams({ s: query.trim(), post_type: 'wp-manga' });
    const res = await this.get(`${this.baseUrl}/${pagePath}?${params.toString()}`);
    return this.parseCards(String(res.data));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));

    const creator = (field: string): string =>
      $(`[data-detail-field='${field}'] a`).toArray()
        .map(element => $(element).text().trim())
        .filter(Boolean)
        .join(', ');

    const status = parseStatus($("[data-detail-field='status']").first().text());

    const descriptionEl = $('#mdxr-summary-text').first();
    const description = descriptionEl.find('p').toArray()
      .map(element => $(element).text().trim())
      .filter(Boolean)
      .join('\n\n') || descriptionEl.text().trim();

    const thumbnail = $('.mdxr-series-cover img').first();
    const thumbnailUrl = (thumbnail.attr('data-src') ?? thumbnail.attr('src') ?? '').trim();

    const terms = (group: string): string[] =>
      $(`[data-term-group='${group}'] a.mdxr-detail-term`).toArray()
        .map(element => $(element).text().trim())
        .filter(Boolean);

    const altNames = $('[data-alternative-preview] bdi').toArray()
      .map(element => $(element).text().trim())
      .filter(Boolean);
    const type = $('.mdxr-type-badge').first().text().trim();
    const genres = [...new Set([...terms('genres'), ...terms('tags')])];

    return {
      title: $('#mdxr-series-title').first().text().trim() || undefined,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: thumbnailUrl ? this.absUrl(thumbnailUrl) : undefined,
      author: creator('author') || undefined,
      artist: creator('artist') || undefined,
      genre: [...new Set([...genres, ...(type ? [type] : [])])].join(', ') || undefined,
      status,
      description: [
        description,
        altNames.length > 0 ? `Alternative Names: ${altNames.join(', ')}` : '',
      ].filter(Boolean).join('\n\n') || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const base = this.absUrl(mangaUrl).replace(/\/+$/, '');
    const chapters: Chapter[] = [];
    let lastUrl: string | undefined;

    for (let page = 1; page <= 100; page++) {
      const res = await this.post(
        `${base}/ajax/chapters/?mdxr_chapter_page=${page}`,
        null,
        {
          headers: {
            Referer: base + '/',
            'X-Requested-With': 'XMLHttpRequest',
          },
          validateStatus: status => status === 404 || (status >= 200 && status < 300),
        },
      );
      if (res.status === 404) break;

      const $ = this.$(String(res.data));
      const pageChapters = this.parseChapters($);
      if (pageChapters.length === 0 || pageChapters[pageChapters.length - 1]?.url === lastUrl) break;

      chapters.push(...pageChapters);
      lastUrl = pageChapters[pageChapters.length - 1]?.url;
    }

    return chapters;
  }

  private parseChapters($: CheerioAPI): Chapter[] {
    const chapters: Chapter[] = [];
    $('li.wp-manga-chapter').each((_, element) => {
      const item = $(element);
      const link = item.find('a[href]').first();
      const href = (link.attr('href') ?? '').trim();
      if (!href) return;

      const nameEl = item.find('.mdxr-chapter-name').first();
      const name = nameEl.text().trim() || link.text().trim();
      if (!name) return;

      const release = Number.parseInt(nameEl.attr('data-chapter-release') ?? '', 10);
      const number = Number.parseFloat(nameEl.attr('data-chapter-number') ?? '');
      chapters.push({
        name,
        url: this.absUrl(href),
        chapterNumber: Number.isNaN(number) ? undefined : number,
        dateUpload: Number.isNaN(release) ? undefined : release * 1000,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    const pages: Page[] = [];
    $('.reading-content img, div.page-break img, img.wp-manga-chapter-img').each((_, element) => {
      const image = $(element);
      const source = (
        image.attr('data-mdx-protected-src') ??
        image.attr('data-src') ??
        image.attr('src') ??
        ''
      ).trim();
      if (!source) return;
      pages.push({ index: pages.length, imageUrl: this.absUrl(source) });
    });
    return pages;
  }
}
