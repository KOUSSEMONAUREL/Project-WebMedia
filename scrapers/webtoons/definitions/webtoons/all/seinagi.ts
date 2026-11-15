import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

function chapterDate(text: string): number | undefined {
  const cleaned = text.split(',').slice(1).join(',').trim();
  const absolute = Date.parse(cleaned);
  if (!Number.isNaN(absolute)) return absolute;

  const relative = /(\d+)\s+(year|month|week|day|hour|minute|second)s?\s+ago/i.exec(text);
  if (!relative) return undefined;

  const amount = Number(relative[1]);
  const unit = relative[2].toLowerCase();
  const now = new Date();
  switch (unit) {
    case 'year': now.setFullYear(now.getFullYear() - amount); break;
    case 'month': now.setMonth(now.getMonth() - amount); break;
    case 'week': now.setDate(now.getDate() - amount * 7); break;
    case 'day': now.setDate(now.getDate() - amount); break;
    case 'hour': now.setHours(now.getHours() - amount); break;
    case 'minute': now.setMinutes(now.getMinutes() - amount); break;
    case 'second': now.setSeconds(now.getSeconds() - amount); break;
    default: return undefined;
  }
  return now.getTime();
}

export class SeinagiScraper extends BaseScraper {
  readonly name = 'Seinagi';
  readonly baseUrl = 'https://reader.seinagi.org.es';
  readonly lang = 'en';

  private parseGroups($: CheerioAPI): Manga[] {
    return $('div.group')
      .toArray()
      .map(element => {
        const group = $(element);
        const link = group.find('a[title]').first();
        const href = link.attr('href') ?? '';
        const title = link.attr('title') ?? link.text().trim();
        if (!href || !title) return undefined;

        const image = group.find('img').first().attr('src') ?? '';
        return {
          title,
          url: this.absUrl(href),
          thumbnailUrl: this.absUrl(image).replace('/thumb_', '/'),
          lang: this.lang,
        } as Manga;
      })
      .filter((manga): manga is Manga => Boolean(manga));
  }

  private async list(path: string): Promise<SearchResult> {
    const res = await this.get(path);
    const $ = this.$(String(res.data));
    return {
      mangas: this.parseGroups($),
      hasNextPage: $('div.next').length > 0,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.list(`/directory/${page}/`);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.list(`/latest/${page}/`);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const body = new URLSearchParams({ search: query.trim() });
    const res = await this.post('/search/', body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${this.baseUrl}/`,
      },
    });
    const $ = this.$(String(res.data));
    return { mangas: this.parseGroups($), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));

    const title = $('h1.title').first().text().replace(/\s+/g, ' ').trim();
    let author: string | undefined;
    let artist: string | undefined;
    let description: string | undefined;

    $('div.info b').each((_, element) => {
      const label = $(element).text().trim().toLowerCase();
      const full = $(element).parent().text().trim();
      const value = full.slice(full.indexOf(':') + 1).trim();
      if (!value) return;
      if (label.includes('author') || label.includes('autor') || label.includes('autore')) author = value;
      else if (label.includes('artist') || label.includes('artista')) artist = value;
      else if (
        label.includes('synopsis') ||
        label.includes('description') ||
        label.includes('descripción') ||
        label.includes('trama')
      ) {
        description = value;
      }
    });

    let thumbnailUrl = $('div.thumbnail img, table.thumb img').first().attr('src') ?? '';
    if (thumbnailUrl) thumbnailUrl = this.absUrl(thumbnailUrl).replace('/thumb_', '/');

    return {
      title: title || undefined,
      url: this.absUrl(mangaUrl),
      thumbnailUrl: thumbnailUrl || undefined,
      author,
      artist,
      description,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));

    return $('div.group div.element, div.list div.element')
      .toArray()
      .map(element => {
        const item = $(element);
        const link = item.find('a[title]').first();
        const href = link.attr('href') ?? '';
        if (!href) return undefined;

        const name = link.text().trim() || link.attr('title') || 'Chapter';
        const dateText = item.find('div.meta_r').first().text().trim();
        return {
          name,
          url: this.absUrl(href),
          dateUpload: dateText ? chapterDate(dateText) : undefined,
        } as Chapter;
      })
      .filter((chapter): chapter is Chapter => Boolean(chapter));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const html = String(res.data);
    const match = /var pages = (\[[\s\S]*?\]);/.exec(html);
    if (!match) return [];

    let pages: Array<{ url?: string }>;
    try {
      pages = JSON.parse(match[1]) as Array<{ url?: string }>;
    } catch {
      return [];
    }

    return pages
      .map(page => page.url ?? '')
      .filter(Boolean)
      .map((url, index) => ({ index, imageUrl: this.absUrl(url) }));
  }
}
