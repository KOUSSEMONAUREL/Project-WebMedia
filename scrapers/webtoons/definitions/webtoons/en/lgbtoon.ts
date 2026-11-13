import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface TitleItemDto {
  href: string;
  title: string;
  cover?: string | null;
}

interface TitlesDto {
  data: {
    items: TitleItemDto[];
    page: number;
    totalPages: number;
  };
}

export class LGBToonScraper extends BaseScraper {
  readonly name = 'LGBToon';
  readonly baseUrl = 'https://lgbtoon.com';
  readonly lang = 'en';

  private titlesUrl(page: number, sort: string): string {
    const url = new URL(`${this.baseUrl}/api/titles`);
    url.searchParams.set('sort', sort);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '24');
    return url.toString();
  }

  private async getTitles(url: string): Promise<SearchResult> {
    const res = await this.get(url, {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const data = (res.data as TitlesDto).data;
    const mangas: Manga[] = data.items.map(item => ({
      title: item.title,
      url: this.absUrl(item.href),
      thumbnailUrl: item.cover ?? '',
      lang: this.lang,
    }));

    return { mangas, hasNextPage: data.page < data.totalPages };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getTitles(this.titlesUrl(page, 'views_7d:desc'));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getTitles(this.titlesUrl(page, 'chapter_updated_at:desc'));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.titlesUrl(page, 'chapter_updated_at:desc'));
    if (query.trim()) url.searchParams.set('keyword', query.trim());
    return this.getTitles(url.toString());
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const html = res.data as string;
    const $ = this.$(html);

    const title = $('.title-detail__title').first().text().trim() || $('h1').first().text().trim();
    const thumbnailUrl =
      $('.title-detail__poster img').first().attr('src') ??
      $("meta[property='og:image']").attr('content') ??
      '';
    const synopsis = $('.title-detail__synopsis p')
      .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean)
      .join('\n');
    const description = synopsis || $('.title-detail__synopsis').first().text().replace(/\s*Read more\s*$/i, '').replace(/\s+/g, ' ').trim();

    const author = $('.title-detail__credit-link')
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean)
      .join(', ');

    const genres: string[] = [];
    $('.title-detail__tag').each((_, element) => {
      const genre = $(element).text().trim();
      if (genre) genres.push(genre);
    });

    const statusMatch = /\\?"status\\?":\\?"(releasing|finished|on_hiatus|discontinued)\\?"/.exec(html);
    const status =
      statusMatch === null
        ? undefined
        : statusMatch[1] === 'releasing'
          ? 1
          : statusMatch[1] === 'finished'
            ? 0
            : statusMatch[1] === 'discontinued'
              ? 2
              : 3;

    return {
      title,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: author || undefined,
      artist: author || undefined,
      genre: genres.join(', ') || undefined,
      description: description || undefined,
      status,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const chapters = new Map<string, { name: string; number?: number }>();
    $("a[href*='/chapter/']").each((_, element) => {
      const link = $(element);
      const href = link.attr('href') ?? '';
      if (!href) return;

      const text = link.text().replace(/\s+/g, ' ').trim();
      const match = /(?:Chapter|Ch\.?)\s*([\d.]+)/i.exec(text);
      const number = match ? Number(match[1]) : undefined;
      const existing = chapters.get(href);

      if (!existing || (existing.number === undefined && number !== undefined)) {
        chapters.set(href, { name: number !== undefined ? `Chapter ${number}` : text || 'Chapter', number });
      }
    });

    return [...chapters.entries()]
      .map(([href, info]) => {
        const chapter: Chapter = {
          name: info.name,
          url: this.absUrl(href),
        };
        if (info.number !== undefined && !Number.isNaN(info.number)) {
          chapter.chapterNumber = info.number;
        }
        return chapter;
      })
      .sort((a, b) => (b.chapterNumber ?? -1) - (a.chapterNumber ?? -1));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);

    const images: string[] = [];
    const seen = new Set<string>();
    $("img[src*='/storage/']").each((_, element) => {
      const src = $(element).attr('src') ?? '';
      if (!src || seen.has(src)) return;
      seen.add(src);
      images.push(this.absUrl(src));
    });

    return images.map((imageUrl, index) => ({ imageUrl, index }));
  }
}
