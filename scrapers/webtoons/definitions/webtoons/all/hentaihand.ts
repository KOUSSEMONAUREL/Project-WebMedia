import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface HhResponseDto<T> {
  data: T;
  next_page_url: string | null;
}

interface HhMangaDto {
  slug: string;
  title: string;
  image_url: string | null;
  artists?: Array<{ name: string }>;
  authors?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
  relationships?: Array<{ name: string }>;
  status?: string;
  alternative_title?: string;
  groups?: Array<{ name: string }>;
  description?: string;
  pages?: number;
  category?: { name: string };
  language?: { name: string };
  parodies?: Array<{ name: string }>;
  characters?: Array<{ name: string }>;
}

interface HhPageListDto {
  images: Array<{ page: number; source_url: string }>;
}

export class HentaiHandOtherScraper extends BaseScraper {
  readonly name = 'HentaiHand';
  readonly baseUrl = 'https://hentaihand.com';
  readonly lang = 'all';
  private readonly hhLangId: number[];

  constructor(hhLangId: number[] = []) {
    super();
    this.hhLangId = hhLangId;
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    const res = await this.get('/api/comics', {
      params: {
        page: page.toString(),
        sort: 'popularity',
        order: 'desc',
        duration: 'all',
        ...this.buildLangParams(),
      },
    });
    return this.parseMangaList(res.data);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const res = await this.get('/api/comics', {
      params: {
        page: page.toString(),
        sort: 'uploaded_at',
        order: 'desc',
        duration: 'all',
        ...this.buildLangParams(),
      },
    });
    return this.parseMangaList(res.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const res = await this.get('/api/comics', {
      params: {
        page: page.toString(),
        q: query,
        ...this.buildLangParams(),
      },
    });
    return this.parseMangaList(res.data);
  }

  private buildLangParams(): Record<string, string> {
    const params: Record<string, string> = {};
    this.hhLangId.forEach((id, index) => {
      params[`languages[${-index - 1}]`] = id.toString();
    });
    return params;
  }

  private parseMangaList(data: HhResponseDto<HhMangaDto[]>): SearchResult {
    return {
      mangas: data.data.map(dto => ({
        title: dto.title,
        url: `/en/comic/${dto.slug}`,
        thumbnailUrl: dto.image_url || '',
        lang: this.lang,
      })),
      hasNextPage: data.next_page_url != null && data.next_page_url !== '',
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.replace('/en/comic/', '');
    const res = await this.get(`/api/comics/${slug}`);
    const dto = res.data as HhMangaDto;
    const toNames = (list?: Array<{ name: string }>): string | undefined => {
      if (!list || list.length === 0) return undefined;
      return list.map(item => item.name).join(', ');
    };
    const descParts: string[] = [];
    if (dto.alternative_title) descParts.push(`Alternative Title: ${dto.alternative_title}`);
    if (dto.groups) descParts.push(`Groups: ${toNames(dto.groups)}`);
    if (dto.description) descParts.push(`Description: ${dto.description}`);
    if (dto.pages) descParts.push(`Pages: ${dto.pages}`);
    if (dto.category) descParts.push(`Category: ${dto.category.name}`);
    if (dto.language) descParts.push(`Language: ${dto.language.name}`);
    if (dto.parodies) descParts.push(`Parodies: ${toNames(dto.parodies)}`);
    if (dto.characters) descParts.push(`Characters: ${toNames(dto.characters)}`);
    return {
      title: dto.title,
      url: mangaUrl,
      thumbnailUrl: dto.image_url || '',
      lang: this.lang,
      author: toNames(dto.artists) || toNames(dto.authors),
      description: descParts.join('\n\n'),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace('/en/comic/', '');
    const res = await this.get(`/api/comics/${slug}`);
    const dto = res.data as HhMangaDto;
    return [{
      name: 'Chapter',
      url: slug,
      dateUpload: 0,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`/api/comics/${chapterUrl}/images`);
    const data = res.data as HhPageListDto;
    return data.images.map(img => ({
      index: img.page,
      imageUrl: img.source_url,
    }));
  }
}
