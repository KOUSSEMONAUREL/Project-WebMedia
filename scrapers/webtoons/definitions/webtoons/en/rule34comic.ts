import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

export class Rule34ComicScraper extends BaseScraper {
  readonly name = 'Rule34Comic';
  readonly baseUrl = 'https://rule34comic.party';
  readonly lang = 'en';

  private siteUrl(...segments: string[]): string {
    return `${this.baseUrl}/${segments.join('/')}${segments.length > 0 ? '/' : ''}`;
  }

  private async getAlbumList(
    pageUrl: string,
    block: string,
    sort: string,
    page: number,
    query?: string,
  ): Promise<SearchResult> {
    const url = new URL(pageUrl);
    url.searchParams.set('mode', 'async');
    url.searchParams.set('function', 'get_block');
    url.searchParams.set('block_id', block);
    url.searchParams.set('sort_by', sort);
    if (query === undefined) {
      url.searchParams.set('from', String(page));
    } else {
      url.searchParams.set('q', query);
      url.searchParams.set('from_albums', String(page));
    }

    const res = await this.get(url.toString(), {
      headers: {
        Accept: 'text/html',
        Referer: pageUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const $ = this.$(res.data);
    const mangas: Manga[] = [];

    $('div.item.thumb:not(.adv-card) > a.th').each((_, element) => {
      const link = $(element);
      const href = link.attr('href') ?? '';
      const title = link.find('.thumb_title').first().text().trim();
      if (!href || !title) return;

      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(link.find('img').first().attr('src') ?? ''),
        lang: this.lang,
      });
    });

    return { mangas, hasNextPage: $('.pagination .item.active ~ .item').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getAlbumList(this.siteUrl(), 'list_albums_most_recent_albums', 'album_viewed', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getAlbumList(this.siteUrl(), 'list_albums_most_recent_albums', 'post_date', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) return this.getPopular(page);
    return this.getAlbumList(
      this.siteUrl('search'),
      'list_albums_albums_list_search_result',
      'album_viewed',
      page,
      query.trim(),
    );
  }

  private ownText($: CheerioAPI, element: Parameters<CheerioAPI>[0]): string {
    return $(element).clone().find('.meta_count').remove().end().text().replace(/\s+/g, ' ').trim();
  }

  private parseRelativeDate(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const match = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(text);
    if (!match) return undefined;

    const units: { [unit: string]: number } = {
      second: 1000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    };
    const amount = Number(match[1]);
    const unit = units[match[2].toLowerCase()];
    if (!unit || Number.isNaN(amount)) return undefined;
    return Date.now() - amount * unit;
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const rows = new Map<string, ReturnType<CheerioAPI>>();
    $('.album-meta-row').each((_, element) => {
      const row = $(element);
      const label = row.find('.album-meta-row__label').first().text().replace(/:$/, '').trim();
      const values = row.find('.album-meta-row__values').first();
      if (label && values.length > 0) rows.set(label, values);
    });

    const title = $('h1.album-hero__title').first().text().trim();
    const artists: string[] = [];
    rows.get('Artists')?.find('a.tag_item').each((_, element) => {
      const href = $(element).attr('href') ?? '';
      if (/\/unknown-artist\/$/.test(href)) return;
      const artist = this.ownText($, element);
      if (artist) artists.push(artist);
    });

    const genres: string[] = [];
    rows.get('Tags')?.find('a.tag_item').each((_, element) => {
      const genre = this.ownText($, element);
      if (genre) genres.push(genre);
    });

    const categories: string[] = [];
    rows.get('Categories')?.find('a').each((_, element) => {
      const category = $(element).text().trim();
      if (category) categories.push(category);
    });

    const pages = rows.get('Pages')?.text().trim();
    const descriptionParts: string[] = [];
    if (pages) descriptionParts.push(`${pages} pages`);
    if (categories.length > 0) descriptionParts.push(`Categories: ${categories.join(', ')}`);

    const artist = artists.join(', ');
    const thumbnailUrl =
      $('img.thumb:not(.lazy-load)').first().attr('src') ??
      $("meta[property='og:image']").attr('content') ??
      '';

    return {
      title,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: artist || undefined,
      artist: artist || undefined,
      genre: genres.join(', ') || undefined,
      description: descriptionParts.join('\n') || undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const uploaded = $('.album-meta-row')
      .filter((_, element) => $(element).find('.album-meta-row__label').first().text().startsWith('Uploaded'))
      .find('.meta_plain')
      .first()
      .text()
      .trim();

    const chapter: Chapter = {
      name: 'Chapter',
      url: this.absUrl(mangaUrl),
      chapterNumber: 1,
    };
    const dateUpload = this.parseRelativeDate(uploaded);
    if (dateUpload !== undefined) chapter.dateUpload = dateUpload;
    return [chapter];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    return $("a.item[href*='/get_image/']")
      .toArray()
      .filter((element, index, elements) => elements.indexOf(element) === index)
      .map((element, index) => ({ imageUrl: this.absUrl($(element).attr('href') ?? ''), index }))
      .filter(page => page.imageUrl !== '');
  }
}
