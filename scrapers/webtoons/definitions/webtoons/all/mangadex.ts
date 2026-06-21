import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.mangadex.org';
const CDN_URL = 'https://uploads.mangadex.org';
const MANGA_LIMIT = 20;
const LATEST_CHAPTER_LIMIT = 100;

function isUuid(text: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
}

function containsUuid(url: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(url);
}

function getMangaListOffset(page: number): string {
  return (MANGA_LIMIT * (page - 1)).toString();
}

function getLatestChapterOffset(page: number): string {
  return (LATEST_CHAPTER_LIMIT * (page - 1)).toString();
}

interface PaginatedResponseDto<T> {
  result: string;
  response?: string;
  data: T[];
  limit: number;
  offset: number;
  total: number;
}

interface ResponseDto<T> {
  result: string;
  response?: string;
  data: T | null;
}

interface MangaDataDto {
  id: string;
  type?: string;
  attributes?: MangaAttributesDto | null;
  relationships: EntityDto[];
}

interface EntityDto {
  id: string;
  type?: string;
  attributes?: any;
  relationships: EntityDto[];
}

interface MangaAttributesDto {
  title: Record<string, string>;
  altTitles: Record<string, string>[];
  description: Record<string, string>;
  originalLanguage?: string;
  lastVolume?: string;
  lastChapter?: string;
  contentRating?: string;
  publicationDemographic?: string;
  status?: string;
  tags: TagDto[];
}

interface TagDto {
  id: string;
  attributes?: TagAttributesDto | null;
}

interface TagAttributesDto {
  group: string;
  name?: Record<string, string>;
}

interface ChapterDataDto {
  id: string;
  attributes?: ChapterAttributesDto | null;
  relationships: EntityDto[];
}

interface ChapterAttributesDto {
  title?: string;
  volume?: string;
  chapter?: string;
  pages: number;
  publishAt: string;
  externalUrl?: string;
  isUnavailable?: boolean;
}

interface CoverArtDto {
  id: string;
  attributes?: CoverArtAttributesDto | null;
  relationships: EntityDto[];
}

interface CoverArtAttributesDto {
  fileName?: string;
  locale?: string;
}

interface AtHomeDto {
  baseUrl: string;
  chapter: AtHomeChapterDto;
}

interface AtHomeChapterDto {
  hash: string;
  data: string[];
  dataSaver: string[];
}

interface AggregateDto {
  result: string;
  volumes?: Record<string, AggregateVolume>;
}

interface AggregateVolume {
  volume: string;
  count: string;
  chapters: Record<string, AggregateChapter>;
}

interface AggregateChapter {
  chapter: string;
  count: string;
}

type MangaListDto = PaginatedResponseDto<MangaDataDto>;
type ChapterListDto = PaginatedResponseDto<ChapterDataDto>;
type CoverArtListDto = PaginatedResponseDto<CoverArtDto>;

export class MangadexScraper extends BaseScraper {
  readonly name = 'MangaDex';
  readonly baseUrl = 'https://mangadex.org';
  readonly lang = 'all';

  private dexLang = 'en';

  async getPopular(page: number): Promise<SearchResult> {
    const url = new URL(`${API_URL}/manga`);
    url.searchParams.set('order[followedCount]', 'desc');
    url.searchParams.set('availableTranslatedLanguage[]', this.dexLang);
    url.searchParams.set('limit', MANGA_LIMIT.toString());
    url.searchParams.set('offset', getMangaListOffset(page));
    url.searchParams.set('includes[]', 'cover_art');
    url.searchParams.set('contentRating[]', 'safe');
    url.searchParams.set('contentRating[]', 'suggestive');
    url.searchParams.set('contentRating[]', 'erotica');
    url.searchParams.set('contentRating[]', 'pornographic');

    const response = await this.get(url.toString());
    return this.parseMangaListResponse(response);
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const p = page ?? 1;
    const trimmedQuery = query.trim();

    if (query.startsWith('id:')) {
      const mangaId = query.slice(3);
      const url = new URL(`${API_URL}/manga`);
      url.searchParams.set('ids[]', mangaId);
      url.searchParams.set('includes[]', 'cover_art');
      url.searchParams.set('contentRating[]', 'safe');
      url.searchParams.set('contentRating[]', 'suggestive');
      url.searchParams.set('contentRating[]', 'erotica');
      url.searchParams.set('contentRating[]', 'pornographic');
      const response = await this.get(url.toString());
      return this.parseMangaListResponse(response);
    }

    if (query.startsWith('ch:')) {
      const chapterId = query.slice(3);
      const chapterUrl = `${API_URL}/chapter/${chapterId}`;
      const chapterResp = await this.get(chapterUrl);
      const chapterDto = JSON.parse(chapterResp) as ResponseDto<ChapterDataDto>;
      const mangaRel = chapterDto.data?.relationships.find(r => r.type === 'manga');
      if (!mangaRel) throw new Error('Unable to find manga from chapter');
      return this.getSearch(`id:${mangaRel.id}`, p);
    }

    if (query.startsWith('author:')) {
      const authorId = query.slice(7);
      const url = new URL(`${API_URL}/manga`);
      url.searchParams.set('authorOrArtist', authorId);
      url.searchParams.set('limit', MANGA_LIMIT.toString());
      url.searchParams.set('offset', getMangaListOffset(p));
      url.searchParams.set('includes[]', 'cover_art');
      url.searchParams.set('contentRating[]', 'safe');
      url.searchParams.set('contentRating[]', 'suggestive');
      url.searchParams.set('contentRating[]', 'erotica');
      url.searchParams.set('contentRating[]', 'pornographic');
      const response = await this.get(url.toString());
      return this.parseMangaListResponse(response);
    }

    if (query.startsWith('grp:')) {
      const groupId = query.slice(4);
      const url = new URL(`${API_URL}/manga`);
      url.searchParams.set('group', groupId);
      url.searchParams.set('limit', MANGA_LIMIT.toString());
      url.searchParams.set('offset', getMangaListOffset(p));
      url.searchParams.set('includes[]', 'cover_art');
      url.searchParams.set('contentRating[]', 'safe');
      url.searchParams.set('contentRating[]', 'suggestive');
      url.searchParams.set('contentRating[]', 'erotica');
      url.searchParams.set('contentRating[]', 'pornographic');
      const response = await this.get(url.toString());
      return this.parseMangaListResponse(response);
    }

    if (query.startsWith('usr:')) {
      const uploader = query.slice(4);
      const url = new URL(`${API_URL}/chapter`);
      url.searchParams.set('offset', getLatestChapterOffset(p));
      url.searchParams.set('limit', LATEST_CHAPTER_LIMIT.toString());
      url.searchParams.set('translatedLanguage[]', this.dexLang);
      url.searchParams.set('order[publishAt]', 'desc');
      url.searchParams.set('includeFutureUpdates', '0');
      url.searchParams.set('uploader', uploader);
      url.searchParams.set('contentRating[]', 'safe');
      url.searchParams.set('contentRating[]', 'suggestive');
      url.searchParams.set('contentRating[]', 'erotica');
      url.searchParams.set('contentRating[]', 'pornographic');
      url.searchParams.set('includeFuturePublishAt', '0');
      url.searchParams.set('includeEmptyPages', '0');
      const response = await this.get(url.toString());
      return this.parseLatestUpdatesResponse(response);
    }

    if (query.startsWith('list:')) {
      const listId = query.slice(5);
      return this.getMangaListFromCustomList(listId, p);
    }

    const url = new URL(`${API_URL}/manga`);
    url.searchParams.set('limit', MANGA_LIMIT.toString());
    url.searchParams.set('offset', getMangaListOffset(p));
    url.searchParams.set('includes[]', 'cover_art');
    if (trimmedQuery) url.searchParams.set('title', trimmedQuery);
    url.searchParams.set('contentRating[]', 'safe');
    url.searchParams.set('contentRating[]', 'suggestive');
    url.searchParams.set('contentRating[]', 'erotica');
    url.searchParams.set('contentRating[]', 'pornographic');

    const response = await this.get(url.toString());
    return this.parseMangaListResponse(response);
  }

  private async getMangaListFromCustomList(listId: string, page: number): Promise<SearchResult> {
    const listUrl = `${API_URL}/list/${listId}`;
    const listResp = await this.get(listUrl);
    const listDto = JSON.parse(listResp) as ResponseDto<{ relationships: EntityDto[] }>;
    const mangaRels = (listDto.data?.relationships || []).filter(r => r.type === 'manga');
    if (mangaRels.length < 1) throw new Error('No series in list');

    const minIndex = (page - 1) * MANGA_LIMIT;
    const ids = mangaRels.slice(minIndex, minIndex + MANGA_LIMIT).map(r => r.id).filter(Boolean);

    const url = new URL(`${API_URL}/manga`);
    url.searchParams.set('limit', MANGA_LIMIT.toString());
    url.searchParams.set('offset', '0');
    url.searchParams.set('includes[]', 'cover_art');
    ids.forEach(id => url.searchParams.set('ids[]', id));
    url.searchParams.set('contentRating[]', 'safe');
    url.searchParams.set('contentRating[]', 'suggestive');
    url.searchParams.set('contentRating[]', 'erotica');
    url.searchParams.set('contentRating[]', 'pornographic');

    const response = await this.get(url.toString());
    const mangas = (await this.parseMangaListResponse(response)).mangas;
    const hasNextPage = mangaRels.length / MANGA_LIMIT - (page - 1) > 1 && ids.length === MANGA_LIMIT;

    return { mangas, hasNextPage };
  }

  private async parseMangaListResponse(response: string): Promise<SearchResult> {
    const data = response.data as MangaListDto;
    if (data.data.length === 0) return { mangas: [], hasNextPage: false };

    const firstVolumeCovers = await this.fetchFirstVolumeCovers(data.data);
    const mangas: Manga[] = data.data.map(m => this.createBasicManga(m, firstVolumeCovers));

    return { mangas, hasNextPage: data.limit + data.offset < data.total };
  }

  private async parseLatestUpdatesResponse(response: string): Promise<SearchResult> {
    const chapterListDto = response.data as ChapterListDto;
    if (chapterListDto.data.length === 0) return { mangas: [], hasNextPage: false };

    const mangaIds = [...new Set(chapterListDto.data.flatMap(c =>
      c.relationships.filter(r => r.type === 'manga').map(r => r.id)
    ))];

    const mangaUrl = new URL(`${API_URL}/manga`);
    mangaUrl.searchParams.set('includes[]', 'cover_art');
    mangaUrl.searchParams.set('limit', mangaIds.length.toString());
    mangaIds.forEach(id => mangaUrl.searchParams.set('ids[]', id));
    mangaUrl.searchParams.set('contentRating[]', 'safe');
    mangaUrl.searchParams.set('contentRating[]', 'suggestive');
    mangaUrl.searchParams.set('contentRating[]', 'erotica');
    mangaUrl.searchParams.set('contentRating[]', 'pornographic');

    const mangaResp = await this.get(mangaUrl.toString());
    const mangaListDto = JSON.parse(mangaResp) as MangaListDto;
    const mangaMap = new Map(mangaListDto.data.map(m => [m.id, m]));
    const firstVolumeCovers = await this.fetchFirstVolumeCovers(mangaListDto.data);

    const mangas = mangaIds.map(id => mangaMap.get(id)).filter(Boolean).map(m => this.createBasicManga(m!, firstVolumeCovers));
    return { mangas, hasNextPage: chapterListDto.limit + chapterListDto.offset < chapterListDto.total };
  }

  private createBasicManga(mangaDataDto: MangaDataDto, firstVolumeCovers: Map<string, string>): Manga {
    const attr = mangaDataDto.attributes;
    const coverId = mangaDataDto.relationships.find(r => r.type === 'cover_art')?.id;
    const coverRel = mangaDataDto.relationships.find(r => r.type === 'cover_art');
    const fileName = firstVolumeCovers.get(mangaDataDto.id) || (coverRel as CoverArtDto)?.attributes?.fileName;

    const titleMap = attr?.title || {};
    const title = titleMap[this.dexLang] || Object.values(titleMap)[0] || '';

    const manga: Manga = {
      url: `/manga/${mangaDataDto.id}`,
      title,
      thumbnail_url: fileName ? `${CDN_URL}/covers/${mangaDataDto.id}/${fileName}` : undefined,
    };

    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const mangaId = mangaUrl.split('/').pop()!;
    const chapters: ChapterDataDto[] = [];

    let offset = 0;
    let hasNextPage = true;

    while (hasNextPage) {
      const url = new URL(`${API_URL}/manga/${mangaId}/feed`);
      url.searchParams.set('includes[]', 'scanlation_group');
      url.searchParams.set('includes[]', 'user');
      url.searchParams.set('limit', '500');
      url.searchParams.set('offset', offset.toString());
      url.searchParams.set('translatedLanguage[]', this.dexLang);
      url.searchParams.set('order[volume]', 'desc');
      url.searchParams.set('order[chapter]', 'desc');
      url.searchParams.set('includeFuturePublishAt', '0');
      url.searchParams.set('includeEmptyPages', '0');
      url.searchParams.set('contentRating[]', 'safe');
      url.searchParams.set('contentRating[]', 'suggestive');
      url.searchParams.set('contentRating[]', 'erotica');
      url.searchParams.set('contentRating[]', 'pornographic');

      const response = await this.get(url.toString());
      const data = response.data as ChapterListDto;
      chapters.push(...data.data);
      hasNextPage = data.limit + data.offset < data.total;
      offset = data.offset + data.limit;
    }

    return chapters
      .filter(c => !(c.attributes?.externalUrl && c.attributes?.pages === 0))
      .map(c => this.createChapter(c));
  }

  private createChapter(chapterDataDto: ChapterDataDto): Chapter {
    const attr = chapterDataDto.attributes!;
    const groups = chapterDataDto.relationships
      .filter(r => r.type === 'scanlation_group' || r.type === 'scanlationGroup')
      .map(r => (r as any).attributes?.name)
      .filter(Boolean)
      .join(' & ');

    const nameParts: string[] = [];
    if (attr.volume) nameParts.push(`Vol.${attr.volume}`);
    if (attr.chapter) nameParts.push(`Ch.${attr.chapter}`);
    if (attr.title) {
      if (nameParts.length > 0) nameParts.push('-');
      nameParts.push(attr.title);
    }
    if (nameParts.length === 0) nameParts.push('Oneshot');

    const date_upload = attr.publishAt ? new Date(attr.publishAt).getTime() : undefined;

    return {
      url: `/chapter/${chapterDataDto.id}`,
      name: nameParts.join(' '),
      date_upload,
      scanlator: groups || 'No Group',
      chapter_number: attr.chapter ? parseFloat(attr.chapter) : undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('/').pop()!;
    const atHomeUrl = `${API_URL}/at-home/server/${chapterId}`;
    const response = await this.get(atHomeUrl);
    const atHomeDto = response.data as AtHomeDto;
    const host = atHomeDto.baseUrl;
    const hash = atHomeDto.chapter.hash;
    const pageSuffixes = atHomeDto.chapter.data.map(f => `/data/${hash}/${f}`);

    return pageSuffixes.map((suffix, index) => {
      const mdAtHomeMetadataUrl = `${host},${atHomeUrl},${Date.now()}`;
      return { index, url: mdAtHomeMetadataUrl, imageUrl: suffix };
    });
  }

  private async fetchFirstVolumeCovers(mangaList: MangaDataDto[]): Promise<Map<string, string>> {
    if (mangaList.length === 0) return new Map();

    const mangaIds = mangaList.map(m => m.id);
    const coverUrl = new URL(`${API_URL}/cover`);
    coverUrl.searchParams.set('order[volume]', 'asc');
    coverUrl.searchParams.set('limit', Math.min(mangaIds.length, 100).toString());
    coverUrl.searchParams.set('offset', '0');
    mangaIds.forEach(id => coverUrl.searchParams.set('manga[]', id));

    try {
      const response = await this.get(coverUrl.toString());
      const result = response.data as CoverArtListDto;
      const map = new Map<string, string>();
      for (const cover of result.data) {
        const mangaRel = cover.relationships.find(r => r.type === 'manga');
        if (mangaRel && cover.attributes?.fileName) {
          if (!map.has(mangaRel.id)) {
            map.set(mangaRel.id, cover.attributes.fileName);
          }
        }
      }
      return map;
    } catch (err) {
      console.error(`Failed to fetch cover art from MangaDex: ${err instanceof Error ? err.message : err}`);
      return new Map();
    }
  }
}
