import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';
import { isJsonObject } from '../../../engine/nextjs';
import type { Json } from '../../../engine/nextjs';

interface SeriesDto {
  name?: string;
  image?: string;
  genre?: string[];
  author?: { name?: string };
  alternateName?: string[];
  description?: string;
}

function firstString(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class NinkoComicsScraper extends BaseScraper {
  readonly name = 'Ninko Comics';
  readonly baseUrl = 'https://ninkocomics.com';
  readonly lang = 'en';

  private async getComics(sort: string, query?: string): Promise<SearchResult> {
    const url = query
      ? `${this.baseUrl}/search?q=${encodeURIComponent(query)}`
      : `${this.baseUrl}/comics?sort=${sort}`;
    const res = await this.get(url);
    return { mangas: this.parseComics(this.$(String(res.data))), hasNextPage: false };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getComics('popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getComics('latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const term = query.trim();
    return this.getComics('popular', term);
  }

  private parseComics($: CheerioAPI): Manga[] {
    return $('a.rk-poster[href^="/comic/"]')
      .toArray()
      .map(element => {
        const poster = $(element);
        const href = poster.attr('href') ?? '';
        const title = poster.find('span.line-clamp-2').first().text().trim();
        if (!href || !title) return undefined;
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(poster.find('img').first().attr('src') ?? ''),
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => Boolean(manga));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const series = this.readSeries($);
    if (!series) return { url: this.absUrl(mangaUrl) };

    const badges = $('h1').first().prev('div').children().toArray().map(el => $(el).text().trim());
    return {
      ...this.toManga(series, this.absUrl(mangaUrl)),
      status: this.parseStatus(badges),
      author: series.author?.name || undefined,
      description: this.description(series, badges),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));

    return $('li[data-chapter-id] > a')
      .toArray()
      .map(element => {
        const link = $(element);
        const href = link.attr('href') ?? '';
        if (!href) return undefined;

        // Early access chapters cost coins until their free day, and upstream
        // hides them by default.
        const locked = link.attr('data-unlock') !== undefined;
        if (locked) return undefined;

        const title = link.find('span.min-w-0 > span').first().text().trim() || 'Chapter';
        const dateLabel = link.find('[data-percent-label]').attr('title');
        const date = dateLabel ? Date.parse(dateLabel) : Number.NaN;

        return {
          name: title,
          url: this.absUrl(href),
          dateUpload: Number.isNaN(date) ? undefined : date,
        } as Chapter;
      })
      .filter((chapter): chapter is Chapter => Boolean(chapter));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(String(res.data));
    return $('img[src*="/media/pages/"]')
      .toArray()
      .map(element => $(element).attr('src') ?? '')
      .filter(Boolean)
      .map((src, index) => ({ index, imageUrl: this.absUrl(src) }));
  }

  private readSeries($: CheerioAPI): SeriesDto | undefined {
    const scripts = $('script[type="application/ld+json"]').toArray();
    for (const script of scripts) {
      const text = $(script).text();
      if (!text.includes('ComicSeries')) continue;
      try {
        const parsed = JSON.parse(text) as Json;
        if (!isJsonObject(parsed)) continue;
        const genres = Array.isArray(parsed.genre)
          ? parsed.genre.filter((item): item is string => typeof item === 'string')
          : [];
        const alternates = Array.isArray(parsed.alternateName)
          ? parsed.alternateName.filter((item): item is string => typeof item === 'string')
          : [];
        return {
          name: firstString(parsed.name),
          image: firstString(parsed.image),
          description: firstString(parsed.description),
          genre: genres,
          alternateName: alternates,
          author: isJsonObject(parsed.author)
            ? { name: firstString(parsed.author.name) }
            : undefined,
        };
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private toManga(series: SeriesDto, url: string): Manga {
    return {
      title: series.name ?? '',
      url,
      thumbnailUrl: series.image ?? '',
      lang: this.lang,
      author: series.author?.name,
      genre: series.genre?.join(', ') || undefined,
    };
  }

  private parseStatus(badges: string[]): MangaStatus {
    if (badges.includes('Ongoing')) return 1;
    if (badges.includes('Completed')) return 0;
    if (badges.includes('Hiatus')) return 3;
    if (badges.includes('Dropped')) return 2;
    return 3;
  }

  private description(series: SeriesDto, badges: string[]): string | undefined {
    const parts: string[] = [];
    const schedule = badges.find(badge => badge.startsWith('New chapter'));
    if (schedule) parts.push(schedule);
    if (series.description) parts.push(series.description);
    if (series.alternateName && series.alternateName.length > 0) {
      parts.push(`Alternative Names: ${series.alternateName.join(', ')}`);
    }
    return parts.join('\n\n') || undefined;
  }
}
