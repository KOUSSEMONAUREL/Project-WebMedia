import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface KaganeBook {
  series_id: string;
  title: string;
  cover_image_id?: string | null;
}

interface KaganeSearchResponse {
  content: KaganeBook[];
  last?: boolean;
  total_pages?: number;
}

interface KaganeDetails {
  slug?: string | null;
}

type KaganeCell = string | number | boolean | null | number[] | undefined;

interface KaganeBookIndex {
  fields: string[];
  groups?: Array<{ title?: string }>;
  books: KaganeCell[][];
}

export class KaganeScraper extends BaseScraper {
  readonly name = 'Kagane';
  readonly baseUrl = 'https://kagane.cx';
  readonly lang = 'all';

  private apiUrl = 'https://kagane.moe/api/v2';

  async getPopular(_page = 1): Promise<SearchResult> {
    const page = _page - 1;
    const body = { source_type: ['Official', 'Unofficial', 'Mixed'], content_lang: [this.lang === 'all' ? 'en' : this.lang] };
    const url = `${this.apiUrl}/search/series?page=${page}&size=35&sort=total_views,desc`;
    const res = await this.post(url, body);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as KaganeSearchResponse;
    const mangas: Manga[] = (data.content || []).map((b) => ({
      title: b.title,
      url: `/series/${b.series_id}`,
      thumbnailUrl: b.cover_image_id ? `${this.apiUrl}/image/${b.cover_image_id}` : '',
      lang: this.lang,
    }));
    const hasNextPage = data.last === false || (typeof data.total_pages === 'number' && page + 1 < data.total_pages);
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const p = page - 1;
    const body: Record<string, unknown> = {
      source_type: ['Official', 'Unofficial', 'Mixed'],
      content_lang: [this.lang === 'all' ? 'en' : this.lang],
    };
    if (query.trim()) body.title = query.trim();
    const url = `${this.apiUrl}/search/series?page=${p}&size=35&sort=total_views,desc`;
    const res = await this.post(url, body);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as KaganeSearchResponse;
    const mangas: Manga[] = (data.content || []).map((b) => ({
      title: b.title,
      url: `/series/${b.series_id}`,
      thumbnailUrl: b.cover_image_id ? `${this.apiUrl}/image/${b.cover_image_id}` : '',
      lang: this.lang,
    }));
    const hasNextPage = data.last === false;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const segment = mangaUrl.split('/').filter(Boolean).pop() || '';
    const id = segment.slice(-36);
    if (!id) return { url: mangaUrl, lang: this.lang };
    try {
      const res = await this.get(`${this.apiUrl}/series/${id}`);
      const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      return { url: mangaUrl, title: data?.title, thumbnailUrl: data?.cover_image_id ? `${this.apiUrl}/image/${data.cover_image_id}` : undefined, lang: this.lang };
    } catch {
      return { url: mangaUrl, lang: this.lang };
    }
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const segment = mangaUrl.split('/').filter(Boolean).pop() || '';
    const id = segment.slice(-36);
    if (!id) return [];

    let slug = '';
    try {
      const detailRes = await this.get(`${this.apiUrl}/series/${id}`);
      const detail = (typeof detailRes.data === 'string' ? JSON.parse(detailRes.data) : detailRes.data) as KaganeDetails;
      slug = detail.slug?.trim() || '';
    } catch {
      slug = '';
    }

    const res = await this.get(`${this.apiUrl}/series/${id}/books/index?fields=List`);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as KaganeBookIndex;
    const fields = data.fields ?? [];
    const groups = data.groups ?? [];
    const cell = (row: KaganeCell[], field: string): KaganeCell => {
      const index = fields.indexOf(field);
      return index >= 0 ? row[index] : undefined;
    };
    const seriesPath = slug ? `${slug}-${id}` : id;

    const chapters = (data.books ?? []).flatMap((row): Chapter[] => {
      const bookId = String(cell(row, 'book_id') ?? '');
      if (!bookId) return [];
      const title = String(cell(row, 'title') ?? '').trim();
      const chapterNo = cell(row, 'chapter_no');
      const volumeNo = cell(row, 'volume_no');
      const name = title || (volumeNo ? `Vol.${String(volumeNo)}` : chapterNo ? `Ch.${String(chapterNo)}` : bookId);
      const rawNumber = cell(row, 'sort_no');
      const number = typeof rawNumber === 'number' ? rawNumber : typeof rawNumber === 'string' ? Number.parseFloat(rawNumber) : undefined;
      const rawDate = cell(row, 'released_at');
      const seconds = typeof rawDate === 'number' ? rawDate : typeof rawDate === 'string' ? Number.parseFloat(rawDate) : undefined;
      const rawGroupIndexes = cell(row, 'group_ix');
      const groupIndexes = Array.isArray(rawGroupIndexes) ? rawGroupIndexes : [];
      const scanlator = groupIndexes
        .map(index => groups[index]?.title?.trim() || '')
        .filter(Boolean)
        .join(', ');
      return [{
        name,
        url: `/series/${seriesPath}/reader/${bookId}`,
        chapterNumber: number !== undefined && Number.isFinite(number) ? number : undefined,
        scanlator: scanlator || undefined,
        dateUpload: seconds !== undefined && Number.isFinite(seconds) ? seconds * 1000 : undefined,
      }];
    });

    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    throw new Error('Kagane: getPageList() not implemented');
  }
}
