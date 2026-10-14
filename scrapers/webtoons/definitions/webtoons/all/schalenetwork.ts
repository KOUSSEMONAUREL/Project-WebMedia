import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `all/schalenetwork` (SchaleNetwork.kt, pkg
 * `all.koharu`). The site is a JS shell: the catalogue lives in a JSON API
 * that only answers when the request carries `Accept: application/json` plus an
 * `Origin`/`Referer` pair — a bare request gets 400.
 *
 * - API:     `https://api.schale.network/books?page=N[&sort=8][&s=…]`
 * - Series:  `https://shupogaki.moe/g/<id>/<key>` (SPA route; the readable
 *   metadata comes from `/books/detail/<id>/<key>`)
 * - Detail:  tags namespaced — 1 artists, 2 circles, 3 parodies, 4 magazines,
 *   5 characters, 6 cosplayers, 7 uploaders (skip "anonymous"), 8 males,
 *   9 females, 10 mixed, 11 language, 12 other, else general
 * - Single chapter "Chapter" (the whole book is one chapter)
 */
interface SchaleEntry {
  id: number;
  key: string;
  title: string;
  thumbnail: { path: string };
}

interface SchaleBooks {
  entries: SchaleEntry[];
  total: number;
  limit: number;
  page: number;
}

interface SchaleTag {
  name: string;
  namespace: number;
}

interface SchaleDetail {
  id: number;
  title: string;
  key: string;
  created_at: number;
  updated_at?: number;
  thumbnails: { base: string; main: { path: string } };
  tags: SchaleTag[];
}

const API_URL = 'https://api.schale.network';

export class SchaleNetworkScraper extends BaseScraper {
  readonly name = 'SchaleNetwork';
  readonly baseUrl = 'https://shupogaki.moe';
  readonly lang = 'all';

  private headers() {
    return {
      Accept: 'application/json',
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/`,
    };
  }

  private async api(path: string): Promise<unknown> {
    const res = await this.get(`${API_URL}${path}`, { headers: this.headers() });
    return res.data;
  }

  private parseBooks(data: unknown): SearchResult {
    const books = data as SchaleBooks;
    const mangas: Manga[] = books.entries.map((entry) => ({
      title: entry.title,
      url: `${entry.id}/${entry.key}`,
      thumbnailUrl: entry.thumbnail?.path ?? '',
      lang: this.lang,
    }));
    return { mangas, hasNextPage: books.page * books.limit < books.total };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.parseBooks(await this.api(`/books?sort=8&page=${page}`));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.parseBooks(await this.api(`/books?page=${page}`));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const terms = query.trim() ? `title:"${query.trim()}"` : '';
    return this.parseBooks(await this.api(`/books?page=${page}&s=${encodeURIComponent(terms)}`));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const data = await this.api(`/books/detail/${mangaUrl}`) as SchaleDetail;
    const byNamespace = (ns: number): string[] =>
      data.tags.filter((t) => t.namespace === ns).map((t) => t.name);
    const circles = byNamespace(2);
    const artists = byNamespace(1);
    const uploaders = byNamespace(7).filter((n) => n !== 'anonymous');
    const capitalize = (names: string[]): string | undefined =>
      names.length > 0
        ? names.map((n) => n.split(' ').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')).join(', ')
        : undefined;
    const detail: Partial<Manga> = {
      title: data.title,
      url: mangaUrl,
      thumbnailUrl: data.thumbnails.base + data.thumbnails.main.path,
      author: capitalize(circles.length > 0 ? circles : artists),
      artist: capitalize(artists),
      genre: capitalize([
        ...artists, ...circles, ...byNamespace(3), ...byNamespace(4), ...byNamespace(5),
        ...byNamespace(6), ...byNamespace(0), ...byNamespace(9), ...byNamespace(8),
        ...byNamespace(10), ...byNamespace(12),
      ]),
      status: 0,
      lang: this.lang,
    };
    const sections: string[] = [];
    const section = (label: string, value: string | undefined): void => {
      if (value) sections.push(`${label}: ${value}`);
    };
    section('Circles', capitalize(circles));
    section('Uploaders', capitalize(uploaders));
    section('Magazines', capitalize(byNamespace(4)));
    section('Cosplayers', capitalize(byNamespace(6)));
    section('Parodies', capitalize(byNamespace(3)));
    section('Characters', capitalize(byNamespace(5)));
    if (sections.length > 0) sections.push('');
    sections.push(`Posted: ${new Date(data.created_at * 1000).toISOString()}`);
    detail.description = sections.join('\n');
    return detail;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const data = await this.api(`/books/detail/${mangaUrl}`) as SchaleDetail;
    return [{
      name: 'Chapter',
      url: mangaUrl,
      dateUpload: (data.updated_at ?? data.created_at) * 1000,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    // Page images need a Turnstile clearance token (auth.schale.network);
    // the pipeline only ingests the series URL, and pages are never requested.
    return [];
  }
}

export default SchaleNetworkScraper;
