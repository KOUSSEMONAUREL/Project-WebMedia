import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.simply-hentai.com/v3';

interface SHObject {
  preview: { sizes: { thumb: string } };
  series: { slug: string; title: string };
  slug: string;
  title: string;
}

interface SHDataAlbum {
  albums: SHObject[];
}

interface SHList<T> {
  pagination: { next: number | null };
  data: T;
}

interface SHWrapper {
  object: SHObject;
}

interface SHAlbum {
  data: {
    artists: { title: string }[];
    characters: { title: string }[];
    created_at: string;
    description?: string;
    preview: { sizes: { thumb: string } };
    series: { slug: string; title: string };
    slug: string;
    tags: { title: string }[];
    title: string;
    translators: { title: string }[];
  };
}

interface SHAlbumPages {
  data: { pages: { page_num: number; sizes: { full: string } }[] };
}

export class SimplyHentaiScraper extends BaseScraper {
  readonly name = 'Simply Hentai';
  readonly baseUrl = 'https://www.simply-hentai.com';
  readonly lang = 'all';

  private readonly apiUrl = API_URL;
  private readonly langName = 'english';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${this.apiUrl}/tag/${this.langName}?type=language&page=${page}`,
      { headers: { Accept: 'application/json' } },
    );
    const body: SHList<SHDataAlbum> = res.data;
    return {
      mangas: body.data.albums.map(a => ({
        url: `/${a.series.slug}/${a.slug}`,
        title: a.title,
        thumbnailUrl: a.preview.sizes.thumb,
        lang: this.lang,
      })),
      hasNextPage: body.pagination.next != null,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${this.apiUrl}/tag/${this.langName}?type=language&page=${page}&sort=newest`,
      { headers: { Accept: 'application/json' } },
    );
    const body: SHList<SHDataAlbum> = res.data;
    return {
      mangas: body.data.albums.map(a => ({
        url: `/${a.series.slug}/${a.slug}`,
        title: a.title,
        thumbnailUrl: a.preview.sizes.thumb,
        lang: this.lang,
      })),
      hasNextPage: body.pagination.next != null,
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${this.apiUrl}/search/complex?query=${encodeURIComponent(query)}&page=${page}&filter[language][0]=${this.langName.charAt(0).toUpperCase() + this.langName.slice(1)}`,
      { headers: { Accept: 'application/json' } },
    );
    const body: SHList<SHWrapper[]> = res.data;
    return {
      mangas: body.data.map(w => ({
        url: `/${w.object.series.slug}/${w.object.slug}`,
        title: w.object.title,
        thumbnailUrl: w.object.preview.sizes.thumb,
        lang: this.lang,
      })),
      hasNextPage: body.pagination.next != null,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slugParts = mangaUrl.split('/').filter(Boolean);
    const res = await this.get(
      `${this.apiUrl}/manga/${slugParts[slugParts.length - 1]}`,
      { headers: { Accept: 'application/json' } },
    );
    const body: SHAlbum = res.data;
    return [{
      name: 'Chapter',
      url: `${body.data.series.slug}/${body.data.slug}/all-pages`,
      scanlator: body.data.translators.map(t => t.title).join(', '),
      dateUpload: new Date(body.data.created_at).getTime() || 0,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parts = chapterUrl.split('/');
    const slug = parts[0];
    const albumSlug = parts[1];
    const res = await this.get(
      `${this.apiUrl}/manga/${albumSlug}/pages`,
      { headers: { Accept: 'application/json' } },
    );
    const body: SHAlbumPages = res.data;
    return body.data.pages.map(p => ({
      index: p.page_num,
      imageUrl: p.sizes.full,
    }));
  }
}
