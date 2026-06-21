import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const MANGA_LIMIT = 20;
const PREFIX_ID_SEARCH = 'id:';

const WEB_URL = 'https://namicomi.com';
const CDN_URL = 'https://uploads.namicomi.com';
const API_URL = 'https://api.namicomi.com';
const API_MANGA_URL = `${API_URL}/title`;
const API_SEARCH_URL = `${API_MANGA_URL}/search`;
const API_CHAPTER_URL = `${API_URL}/chapter`;
const API_GATING_CHECK_URL = `${API_URL}/gating/check`;

const COVER_ART = 'cover_art';
const ORGANIZATION = 'organization';
const TAG = 'tag';
const PRIMARY_TAG = 'primary_tag';
const SECONDARY_TAG = 'secondary_tag';
const CHAPTER = 'chapter';
const LOCK_SYMBOL = '🔒';

const tagGroupsOrder = ['content-warnings', 'format', 'genre', 'theme'];

export class NamiComiScraper extends BaseScraper {
  readonly name = 'NamiComi';
  readonly baseUrl = WEB_URL;
  readonly lang = 'en';
  private readonly extLang = 'en';

  private coverQuality = '';
  private useDataSaver = false;
  private showLockedChapters = true;

  async getPopular(page: number): Promise<SearchResult> {
    return this.sortedManga(page, 'views');
  }

  async getLatest(page: number): Promise<SearchResult> {
    return this.sortedManga(page, 'publishedAt');
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const pageNum = page || 1;

    if (query.startsWith('https://')) {
      try {
        const urlObj = new URL(query);
        if (urlObj.hostname !== new URL(this.baseUrl).hostname) {
          throw new Error('Unsupported url');
        }
        const id = urlObj.pathname.split('/')[2];
        return this.getSearch(`${PREFIX_ID_SEARCH}${id}`, page);
      } catch (err) {
        console.error(`Failed to parse URL ${query} on ${this.name}: ${err instanceof Error ? err.message : err}`);
        throw new Error('Unsupported url');
      }
    }

    if (query.startsWith(PREFIX_ID_SEARCH)) {
      const mangaId = query.replace(PREFIX_ID_SEARCH, '');
      if (!mangaId) throw new Error('Invalid manga id');

      const url = this.buildUrl(`${API_SEARCH_URL}`)
        .addQueryParameter('ids[]', mangaId)
        .addCommonIncludeParameters()
        .build();
      const data = await this.get(url.toString());
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      const manga = this.createManga(result.data, this.extLang);
      return { mangas: [manga], hasNextPage: false };
    }

    const tempUrl = this.buildUrl(API_SEARCH_URL)
      .addQueryParameter('limit', MANGA_LIMIT.toString())
      .addQueryParameter('offset', this.getMangaListOffset(pageNum))
      .addCommonIncludeParameters();

    const actualQuery = query.replace(/\s/g, ' ').trim();
    if (actualQuery) {
      tempUrl.addQueryParameter('title', actualQuery);
    }

    const data = await this.get(tempUrl.build().toString());
    return this.mangaListParse(data);
  }

  async getMangaDetail(mangaUrl: string): Promise<Manga> {
    const url = this.buildUrl(`${API_MANGA_URL}/${mangaUrl}`)
      .addCommonIncludeParameters()
      .build();
    const data = await this.get(url.toString());
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return this.createManga(result.data, this.extLang);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const allChapters = await this.fetchAllChapters(mangaUrl, this.extLang);
    if (allChapters.length === 0) return [];

    const chunks = this.chunkArray(allChapters.map(ch => ch.id), 200);
    const accessibleMap = new Map<string, boolean>();

    for (const chunk of chunks) {
      const body = JSON.stringify({
        entities: chunk.map((id: string) => ({ entityId: id, entityType: CHAPTER })),
      });
      const resp = await this.post(API_GATING_CHECK_URL, body);
      const result = typeof resp === 'string' ? JSON.parse(resp) : resp;
      const mapData = result.data?.attributes?.map;
      if (mapData) {
        for (const [key, val] of Object.entries(mapData)) {
          accessibleMap.set(key, val as boolean);
        }
      }
    }

    return allChapters.mapNotNull(ch => {
      const isAccessible = accessibleMap.get(ch.id) ?? false;
      if (isAccessible) {
        return this.createChapter(ch);
      }
      if (this.showLockedChapters) {
        const chapter = this.createChapter(ch);
        chapter.name = `${LOCK_SYMBOL} ${chapter.name}`;
        return chapter;
      }
      return null;
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = `${API_URL}/images/chapter/${chapterUrl}?newQualities=true`;
    const data = await this.get(url);
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    const pageData = result.data;
    if (!pageData) return [];

    const hash = pageData.hash;
    const prefix = `${pageData.baseUrl}/chapter/${chapterUrl}/${hash}`;
    const images = this.useDataSaver ? pageData.low : pageData.source;

    return (images || []).map((img: any, i: number) => ({
      index: i,
      url: `${prefix}/${this.useDataSaver ? 'low' : 'source'}/${img.filename}`,
    }));
  }

  private async sortedManga(page: number, orderBy: string): Promise<SearchResult> {
    const url = this.buildUrl(API_SEARCH_URL)
      .addQueryParameter(`order[${orderBy}]`, 'desc')
      .addQueryParameter('availableTranslatedLanguages[]', this.extLang)
      .addQueryParameter('limit', MANGA_LIMIT.toString())
      .addQueryParameter('offset', this.getMangaListOffset(page))
      .addCommonIncludeParameters()
      .build();
    const data = await this.get(url.toString());
    return this.mangaListParse(data);
  }

  private async mangaListParse(response: any): Promise<SearchResult> {
    if (typeof response === 'string' && response.length === 0) {
      return { mangas: [], hasNextPage: false };
    }
    const result = response.data;
    if (!result.data) return { mangas: [], hasNextPage: false };
    const mangas = result.data.map((dto: any) => this.createManga(dto, this.extLang));
    const hasNextPage = result.meta ? (result.meta.limit + result.meta.offset < result.meta.total) : false;
    return { mangas, hasNextPage };
  }

  private async fetchAllChapters(mangaId: string, extLang: string): Promise<any[]> {
    const results: any[] = [];
    let offset = 0;
    let hasNextPage = true;

    while (hasNextPage) {
      const url = this.buildUrl(API_CHAPTER_URL)
        .addQueryParameter('titleId', mangaId)
        .addQueryParameter('includes[]', ORGANIZATION)
        .addQueryParameter('limit', '200')
        .addQueryParameter('offset', offset.toString())
        .addQueryParameter('translatedLanguages[]', extLang)
        .addQueryParameter('order[volume]', 'desc')
        .addQueryParameter('order[chapter]', 'desc')
        .build();
      const data = await this.get(url.toString());
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      results.push(...result.data);
      hasNextPage = result.meta?.hasNextPage ?? false;
      offset += result.meta?.limit || 200;
    }

    return results;
  }

  private createManga(dto: any, lang: string): Manga {
    const attr = dto.attributes;
    const title = attr.title[lang] || Object.values(attr.title)[0] as string;

    const organizations = (dto.relationships || [])
      .filter((r: any) => r.type === ORGANIZATION)
      .map((r: any) => r.attributes?.name)
      .filter(Boolean)
      .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

    const coverRel = (dto.relationships || []).find((r: any) => r.type === COVER_ART);
    const coverFileName = coverRel?.attributes?.fileName;

    const nonGenres: string[] = [];
    if (attr.contentRating && attr.contentRating !== 'safe') {
      nonGenres.push(`Content: ${attr.contentRating}`);
    }
    if (attr.originalLanguage) {
      try {
        const display = new Intl.DisplayNames([lang], { type: 'language' }).of(attr.originalLanguage);
        if (display) nonGenres.push(display);
      } catch (err) {
        console.error(`Failed to create display name for language ${attr.originalLanguage} on ${this.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const tags = (dto.relationships || [])
      .filter((r: any) => ['tag', 'primary_tag', 'secondary_tag'].includes(r.type));

    const tagMap: Record<string, string[]> = {};
    for (const t of tags) {
      const group = t.attributes?.group || 'genre';
      if (!tagMap[group]) tagMap[group] = [];
      tagMap[group].push(t.id);
    }

    const genreList = tagGroupsOrder.flatMap(g => tagMap[g] || []);

    let status = 0;
    switch (attr.publicationStatus) {
      case 'ongoing': status = 1; break;
      case 'completed': status = 2; break;
      case 'hiatus': status = 3; break;
      case 'cancelled': status = 6; break;
    }

    const manga: Manga = {
      title,
      url: dto.id,
      description: attr.description[lang] || attr.description.en || '',
      author: organizations.join(', '),
      status,
      genre: [...genreList, ...nonGenres].filter(Boolean).join(', '),
    };

    if (coverFileName) {
      manga.thumbnail_url = `${CDN_URL}/covers/${dto.id}/${coverFileName}${this.coverQuality}`;
    }

    return manga;
  }

  private createChapter(dto: any): Chapter {
    const attr = dto.attributes;
    const parts: string[] = [];

    if (attr.volume) parts.push(`Vol.${attr.volume}`);
    if (attr.chapter) parts.push(`Ch.${attr.chapter}`);
    if (attr.name) {
      if (parts.length) parts.push('-');
      parts.push(attr.name);
    }

    return {
      url: dto.id,
      name: parts.join(' '),
      date_upload: this.parseDate(attr.publishAt),
    };
  }

  private getMangaListOffset(page: number): string {
    return (MANGA_LIMIT * (page - 1)).toString();
  }

  private buildUrl(base: string): URLBuilder {
    const url = new URL(base);
    const builder: URLBuilder = {
      addQueryParameter: (key: string, value: string) => {
        url.searchParams.append(key, value);
        return builder;
      },
      addCommonIncludeParameters: () => {
        url.searchParams.append('includes[]', COVER_ART);
        url.searchParams.append('includes[]', ORGANIZATION);
        url.searchParams.append('includes[]', TAG);
        url.searchParams.append('includes[]', PRIMARY_TAG);
        url.searchParams.append('includes[]', SECONDARY_TAG);
        return builder;
      },
      build: () => url,
    };
    return builder;
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  private parseDate(dateStr: string): number {
    return Date.parse(dateStr) || 0;
  }
}

interface URLBuilder {
  addQueryParameter(key: string, value: string): URLBuilder;
  addCommonIncludeParameters(): URLBuilder;
  build(): URL;
}
