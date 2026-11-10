import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface ReaderPageDto {
  l: string;
  f: string;
}

interface ReaderDto {
  baseUriImg: string;
  pages: Record<string, ReaderPageDto>;
}

const POSTED_REGEX = /(\d+) (second|minute|hour|day|week|month|year)s? ago/;
const READER_PAGES_REGEX = /readerPages\s*=\s*JSON\.parse\(atob\("([^"]+)"/;

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export class HentaiForceScraper extends BaseScraper {
  override readonly name = 'HentaiForce';
  override readonly baseUrl = 'https://hentaiforce.net';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.galleryList(this.listUrl(['language', 'english', 'popular'], page));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.galleryList(this.listUrl([], page));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const search = query.trim();
    if (!search) return this.getLatest(page);
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', search);
    if (page > 1) url.searchParams.set('page', String(page));
    return this.galleryList(url.toString());
  }

  private listUrl(segments: string[], page: number): string {
    let path = segments.length > 0 ? `/${segments.join('/')}` : '';
    if (page > 1) {
      if (segments.length === 0) path += '/page';
      path += `/${page}`;
    }
    return this.absUrl(path || '/');
  }

  private async galleryList(url: string): Promise<SearchResult> {
    const response = await this.get(url);
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('.listing-galleries-container .gallery').each((_, el) => {
      const gallery = $(el);
      const link = gallery.find('.gallery-name a').first();
      const href = link.attr('href') || '';
      if (!href.includes('/view/')) return;
      const thumbnail = this.absUrl(gallery.find('.gallery-thumb img').first().attr('data-src') || '');
      mangas.push({
        title: link.text(),
        url: this.absUrl(href),
        thumbnailUrl: thumbnail.replace('-thumb.', '-cover.'),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('.pagination a[rel=next]').length > 0 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const absoluteUrl = this.absUrl(mangaUrl);
    const response = await this.get(absoluteUrl);
    const $ = this.$(response.data);
    const info = $('#gallery-main-info').first();
    const artists = this.links($, info, 'Artists');
    const categories = this.links($, info, 'Category');
    const tags = this.links($, info, 'Tags');
    const parts: string[] = [];
    const parodies = this.links($, info, 'Parodies');
    const characters = this.links($, info, 'Characters');
    const languages = this.links($, info, 'Languages');
    if (parodies.length > 0) parts.push(`Parodies: ${parodies.join(', ')}`);
    if (characters.length > 0) parts.push(`Characters: ${characters.join(', ')}`);
    if (languages.length > 0) parts.push(`Languages: ${languages.join(', ')}`);
    const pages = this.field($, info, 'Pages');
    if (pages) parts.push(`Pages: ${pages}`);
    return {
      url: absoluteUrl,
      title: info.find('h1').first().text(),
      thumbnailUrl: this.absUrl($('#gallery-main-cover img').first().attr('data-src') || ''),
      author: artists.length > 0 ? artists.join(', ') : undefined,
      artist: artists.length > 0 ? artists.join(', ') : undefined,
      genre: [...new Set([...categories, ...tags])].join(', ') || undefined,
      status: 0,
      description: parts.join('\n\n'),
    };
  }

  private links($: ReturnType<typeof this.$>, container: ReturnType<ReturnType<typeof this.$>>, label: string): string[] {
    const section = container
      .find('.tag-container')
      .filter((_, el) => $(el).text().includes(`${label}:`))
      .first();
    return section.find('a.tag-btn').toArray().map(el => $(el).text().trim());
  }

  private field($: ReturnType<typeof this.$>, container: ReturnType<ReturnType<typeof this.$>>, label: string): string | undefined {
    const section = container
      .find('.tag-container')
      .filter((_, el) => $(el).text().includes(`${label}:`))
      .first();
    if (section.length === 0) return undefined;
    const value = section.text().replace(`${label}:`, '').trim();
    return value || undefined;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const info = $('#gallery-main-info').first();
    const posted = this.field($, info, 'Posted');
    return [{
      name: 'Chapter',
      url: this.absUrl(`/view/${this.galleryId(mangaUrl)}/1`),
      dateUpload: this.parsePosted(posted),
    }];
  }

  private galleryId(url: string): string {
    const id = new URL(this.absUrl(url)).pathname.split('/').filter(Boolean)[1];
    if (!id) throw new Error('HentaiForce: invalid gallery URL');
    return id;
  }

  private parsePosted(posted: string | undefined): number | undefined {
    if (!posted) return undefined;
    const match = POSTED_REGEX.exec(posted);
    if (!match) return undefined;
    const amount = Number(match[1]);
    const unit = match[2];
    return Date.now() - amount * (UNIT_MS[unit] ?? UNIT_MS.year);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    let match: RegExpExecArray | null = null;
    for (const el of $('script').toArray()) {
      match = READER_PAGES_REGEX.exec($(el).text());
      if (match) break;
    }
    if (!match) throw new Error('HentaiForce: reader pages not found');
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const reader = JSON.parse(decoded) as ReaderDto;
    return Object.keys(reader.pages)
      .map(key => Number(key))
      .sort((a, b) => a - b)
      .map((key, index) => {
        const page = reader.pages[String(key)];
        return {
          index,
          imageUrl: reader.baseUriImg.replace('%c', page.l).replace('%s', page.f),
        };
      });
  }
}
