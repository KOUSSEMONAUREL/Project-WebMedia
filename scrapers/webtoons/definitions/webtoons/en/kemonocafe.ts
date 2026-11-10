import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Element } from 'domhandler';

interface ArchivePost {
  url: string;
  date: Date;
}

interface ArchiveChapter {
  name: string;
  posts: ArchivePost[];
}

interface Period {
  year: number;
  month: number | null;
}

interface YearMonth {
  year: number;
  month: number;
}

function yearMonth(date: Date): YearMonth {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year === b.year ? a.month - b.month : a.year - b.year;
}

function periodFromYearMonth(value: YearMonth): Period {
  return { year: value.year, month: value.month };
}

function periodFirst(period: Period): YearMonth {
  return { year: period.year, month: period.month ?? 1 };
}

function periodLast(period: Period): YearMonth {
  return { year: period.year, month: period.month ?? 12 };
}

function periodNext(period: Period): Period {
  return period.month !== null && period.month < 12
    ? { year: period.year, month: period.month + 1 }
    : { year: period.year + 1, month: null };
}

function parseDate(text: string): Date | null {
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export class KemonoCafeScraper extends BaseScraper {
  override readonly name = 'Kemono Café';
  override readonly baseUrl = 'https://kemono.cafe';
  override readonly lang = 'en';

  private get siteHost(): string {
    return new URL(this.baseUrl).host;
  }

  private isComicHost(host: string): boolean {
    return host.endsWith(`.${this.siteHost}`);
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    return { mangas: await this.fetchComics(), hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.toLowerCase();
    const comics = await this.fetchComics();
    return {
      mangas: comics.filter(manga => manga.title.toLowerCase().includes(term)),
      hasNextPage: false,
    };
  }

  private async fetchComics(): Promise<Manga[]> {
    const response = await this.get(this.baseUrl);
    const $ = this.$(String(response.data));
    const comicUrl = $('section.comic_list a[href]').toArray()
      .map(el => this.absUrl($(el).attr('href') ?? ''))
      .find(href => {
        if (!href) return false;
        try {
          return this.isComicHost(new URL(href).host);
        } catch {
          return false;
        }
      });
    if (!comicUrl) return [];
    const comicResponse = await this.get(comicUrl);
    return this.parseMenu(this.$(String(comicResponse.data)));
  }

  private parseMenu($: ReturnType<BaseScraper['$']>): Manga[] {
    return $('nav.menu-content a.menu-comic').toArray()
      .map(el => this.menuEntry($, el))
      .filter((manga): manga is Manga => manga !== null);
  }

  private menuEntry($: ReturnType<BaseScraper['$']>, el: Element): Manga | null {
    const link = $(el);
    const href = this.absUrl(link.attr('href') ?? '');
    if (!href) return null;
    const title = link.find('.menu-comic-title').first().text().trim();
    if (!title) return null;
    const author = link.find('.menu-comic-author').first().text().trim() || undefined;
    const parts: string[] = [];
    const heading = link.parent().prev().text().trim();
    if (heading && heading !== 'Archived') parts.push(heading);
    const adult = link.find('.adult-chip').first().text().trim();
    if (adult) parts.push(adult);
    const thumbnail = link.find('img').first().attr('src');
    return {
      title,
      url: href,
      thumbnailUrl: thumbnail ? this.absUrl(thumbnail) : '',
      lang: this.lang,
      author,
      artist: author,
      genre: parts.join(', ') || undefined,
    };
  }

  private comicHome(mangaUrl: string): string | null {
    try {
      const url = new URL(this.absUrl(mangaUrl));
      if (!this.isComicHost(url.host)) return null;
      return new URL('/', url).toString();
    } catch {
      return null;
    }
  }

  private archiveUrl(comicHome: string): string {
    return new URL('archive/', comicHome).toString();
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const comicHome = this.comicHome(mangaUrl);
    if (!comicHome) return {};
    const response = await this.get(this.archiveUrl(comicHome));
    const $ = this.$(String(response.data));
    return this.parseDetails($, comicHome) ?? {};
  }

  private parseDetails($: ReturnType<BaseScraper['$']>, comicHome: string): Manga | null {
    const host = new URL(comicHome).host;
    const entry = $('nav.menu-content a.menu-comic').toArray().find(el => {
      const href = this.absUrl($(el).attr('href') ?? '');
      if (!href) return false;
      try {
        return new URL(href).host === host;
      } catch {
        return false;
      }
    });
    if (!entry) return null;
    const manga = this.menuEntry($, entry);
    if (!manga) return null;
    const description = $('meta[name=description]').first().attr('content')?.trim() || undefined;
    return { ...manga, url: comicHome, description };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const comicHome = this.comicHome(mangaUrl);
    if (!comicHome) return [];
    const response = await this.get(this.archiveUrl(comicHome));
    const $ = this.$(String(response.data));
    const archive = this.parseArchive($);
    if (archive.length === 0) {
      return [{ name: 'Chapter 1', url: new URL('comic/', comicHome).toString() }];
    }
    return archive.map(chapter => {
      const first = chapter.posts[0];
      return {
        name: chapter.name,
        url: first.url,
        dateUpload: first.date.getTime(),
      };
    }).sort((a, b) => (a.dateUpload ?? 0) - (b.dateUpload ?? 0)).reverse();
  }

  private parseArchive($: ReturnType<BaseScraper['$']>): ArchiveChapter[] {
    return $('.comic-archive-chapter-wrap').toArray().map(wrap => {
      const entry = $(wrap);
      const name = entry.find('.comic-archive-chapter').first().text().trim();
      const posts = entry.find('.comic-list').toArray().map(post => {
        const item = $(post);
        const href = item.find('.comic-archive-title a').first().attr('href') ?? '';
        const dateText = item.find('.comic-archive-date').first().text().trim();
        const date = parseDate(dateText);
        if (!href || !date) return null;
        return { url: this.absUrl(href), date };
      }).filter((post): post is ArchivePost => post !== null);
      return { name, posts };
    }).filter(chapter => chapter.name.length > 0 && chapter.posts.length > 0);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapter = new URL(this.absUrl(chapterUrl));
    const start = chapter.toString();
    const comicHome = new URL('/', chapter).toString();
    const response = await this.get(this.archiveUrl(comicHome));
    const archive = this.parseArchive(this.$(String(response.data)));

    const owner = new Map<string, string>();
    for (const archived of archive) {
      const first = archived.posts[0];
      if (!first) continue;
      for (const post of archived.posts) owner.set(post.url, first.url);
    }

    const own = archive.find(archived => archived.posts[0]?.url === start);
    const chapterless = start === new URL('comic/', comicHome).toString();
    if (chapterless ? archive.length !== 0 : own === undefined) {
      throw new Error('Chapter not found, refresh the chapter list');
    }

    const ownMonths = own ? own.posts.map(post => yearMonth(post.date)) : [];
    const ownPosts = ownMonths.length;
    let isFirst = chapterless;
    if (!isFirst && own) {
      const earliest = archive.reduce(
        (min, current) => current.posts[0].date < min.posts[0].date ? current : min,
        archive[0],
      );
      isFirst = earliest === own;
    }

    let period: Period | null = isFirst ? null : periodFromYearMonth(ownMonths[0]);
    let url: string | null = this.listingUrl(comicHome, period);
    let current: string | null = isFirst ? start : null;
    let seen = 0;
    let lastPost: string | null = null;
    const pages: string[] = [];

    while (url !== null) {
      const pageResponse = await this.get(url);
      const $ = this.$(String(pageResponse.data));
      const articles = $('article.type-comic').toArray();

      for (const article of articles) {
        const item = $(article);
        const href = item.find('.entry-title a').first().attr('href') ?? '';
        if (!href) continue;
        const post = this.absUrl(href);
        lastPost = post;
        const ownerUrl = owner.get(post);
        if (ownerUrl !== undefined) current = ownerUrl;
        if (current === start) {
          const image = item.find('img.wp-post-image').first().attr('src') ?? '';
          if (image) pages.push(this.absUrl(image));
          if (ownerUrl === start) seen++;
        } else if (seen === ownPosts) {
          return this.toPages(pages);
        }
      }

      const nextHref = $('a.next.page-numbers').first().attr('href');
      const next = nextHref ? this.absUrl(nextHref) : null;
      const nextOwnMonth = seen > 0 ? ownMonths[seen] : undefined;
      const listed = period;

      if (listed === null) {
        url = next;
      } else if (current !== start && nextOwnMonth !== undefined && compareYearMonth(nextOwnMonth, periodLast(listed)) > 0) {
        period = periodFromYearMonth(nextOwnMonth);
        url = this.listingUrl(comicHome, period);
      } else if (next !== null) {
        url = next;
      } else if (current !== start) {
        url = null;
      } else {
        let candidate: Period | null = null;
        if (articles.length === 0) {
          if (lastPost) {
            const nextMonth = await this.nextPostMonth(lastPost);
            if (nextMonth) candidate = periodFromYearMonth(nextMonth);
          }
        } else {
          candidate = periodNext(listed);
        }
        let chosen: Period | null = null;
        if (candidate) {
          const first = periodFirst(candidate);
          if (compareYearMonth(first, periodLast(listed)) > 0 && compareYearMonth(first, yearMonth(new Date())) <= 0) {
            chosen = candidate;
          }
        }
        period = chosen;
        url = chosen ? this.listingUrl(comicHome, chosen) : null;
      }
    }

    return this.toPages(pages);
  }

  private async nextPostMonth(post: string): Promise<YearMonth | null> {
    const response = await this.get(post);
    const $ = this.$(String(response.data));
    const href = $('a.comic-nav-next').first().attr('href') ?? '';
    if (!href) return null;
    const nextResponse = await this.get(this.absUrl(href));
    const next = this.$(String(nextResponse.data));
    const date = parseDate(next('span.date').first().text().trim());
    return date ? yearMonth(date) : null;
  }

  private listingUrl(comicHome: string, period: Period | null): string {
    const url = new URL(comicHome);
    if (period) {
      const month = period.month === null ? '' : `${String(period.month).padStart(2, '0')}/`;
      url.pathname = `/${period.year}/${month}`;
    }
    url.searchParams.set('post_type', 'comic');
    url.searchParams.set('orderby', 'date');
    url.searchParams.set('order', 'asc');
    return url.toString();
  }

  private toPages(images: string[]): Page[] {
    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
