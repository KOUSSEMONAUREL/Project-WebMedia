import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const QUERY_API = 'https://icq-api.inkr.com/v1';
const CONTENT_API = 'https://icd-api.inkr.com/v1';
const PAGE_SIZE = 20;
const BATCH_SIZE = 50;
const IMAGE_VARIANT = 'w1600.ikc';

// ---------- Genre definitions (from upstream Filters.kt) ----------
const GENRES: ReadonlyArray<readonly [string, string]> = [
  ['Action', 'ik-genre-2'],
  ['Adult Cast', 'ik-genre-93'],
  ['Adult Men', 'ik-genre-87'],
  ['Adult Women', 'ik-genre-138'],
  ['Adventure', 'ik-genre-8'],
  ['Age Gap', 'ik-genre-149'],
  ['Alternative World', 'ik-genre-143'],
  ['Animals', 'ik-genre-31'],
  ['Anthropomorphic', 'ik-genre-35'],
  ['Avant Garde', 'ik-genre-151'],
  ['BL / Boys Love', 'ik-genre-33'],
  ['CEOs', 'ik-genre-156'],
  ['CGDCT', 'ik-genre-94'],
  ['Childcare', 'ik-genre-95'],
  ['Childhood Friends', 'ik-genre-150'],
  ['Cohabitation', 'ik-genre-144'],
  ['Combat Sports', 'ik-genre-96'],
  ['Comedy', 'ik-genre-3'],
  ['Coming of Age', 'ik-genre-147'],
  ['Crime', 'ik-genre-25'],
  ['Crossdressing', 'ik-genre-97'],
  ['Cultivation', 'ik-genre-142'],
  ['Cyberpunk', 'ik-genre-98'],
  ['Delinquents', 'ik-genre-99'],
  ['Detective', 'ik-genre-100'],
  ['Disability', 'ik-genre-145'],
  ['Drama', 'ik-genre-12'],
  ['Ecchi', 'ik-genre-6'],
  ['Educational', 'ik-genre-101'],
  ['Family Life', 'ik-genre-148'],
  ['Fantasy', 'ik-genre-9'],
  ['Folklore', 'ik-genre-158'],
  ['Gag Humor', 'ik-genre-102'],
  ['Gender Bender', 'ik-genre-62'],
  ['GL / Girls Love', 'ik-genre-30'],
  ['Gore', 'ik-genre-103'],
  ['Gourmet', 'ik-genre-91'],
  ['Harem', 'ik-genre-43'],
  ['Harem Fight', 'ik-genre-137'],
  ['Healing', 'ik-genre-107'],
  ['High Stakes Game', 'ik-genre-104'],
  ['Historical', 'ik-genre-18'],
  ['Historical Fiction', 'ik-genre-59'],
  ['Horror', 'ik-genre-16'],
  ['Idols (Female)', 'ik-genre-105'],
  ['Idols (Male)', 'ik-genre-106'],
  ['Individual Sport', 'ik-genre-157'],
  ['Isekai', 'ik-genre-38'],
  ['Kids', 'ik-genre-141'],
  ['LGBTQI', 'ik-genre-32'],
  ['Love Polygon', 'ik-genre-108'],
  ['Magic', 'ik-genre-10'],
  ['Magical Girls', 'ik-genre-110'],
  ['Magical Sex Shift', 'ik-genre-109'],
  ['Married Life', 'ik-genre-155'],
  ['Martial Arts', 'ik-genre-4'],
  ['Mature', 'ik-genre-58'],
  ['Mecha', 'ik-genre-15'],
  ['Medical', 'ik-genre-111'],
  ['Memoir', 'ik-genre-112'],
  ['Military', 'ik-genre-41'],
  ['Music', 'ik-genre-21'],
  ['Mystery', 'ik-genre-24'],
  ['Mythology', 'ik-genre-113'],
  ['Neighbors', 'ik-genre-160'],
  ['Omegaverse', 'ik-genre-152'],
  ['One Shot', 'ik-genre-23'],
  ['Organized Crime', 'ik-genre-114'],
  ['Otaku Culture', 'ik-genre-115'],
  ['Parody', 'ik-genre-60'],
  ['Performing Arts', 'ik-genre-116'],
  ['Pirates', 'ik-genre-154'],
  ['Political', 'ik-genre-136'],
  ['Psychological', 'ik-genre-11'],
  ['Racing', 'ik-genre-118'],
  ['Reincarnation', 'ik-genre-119'],
  ['Religion', 'ik-genre-159'],
  ['Revenge', 'ik-genre-146'],
  ['Reverse Harem', 'ik-genre-120'],
  ['Romance', 'ik-genre-5'],
  ['Romantic Subtext', 'ik-genre-121'],
  ['Samurai', 'ik-genre-122'],
  ['School', 'ik-genre-7'],
  ['Sci-Fi', 'ik-genre-27'],
  ['Showbiz', 'ik-genre-123'],
  ['Shoujo Ai', 'ik-genre-28'],
  ['Shounen Ai', 'ik-genre-19'],
  ['Slice of Life', 'ik-genre-13'],
  ['Space', 'ik-genre-124'],
  ['Sports', 'ik-genre-20'],
  ['Steampunk', 'ik-genre-135'],
  ['Strategy Game', 'ik-genre-125'],
  ['Super Power', 'ik-genre-126'],
  ['Superhero', 'ik-genre-29'],
  ['Supernatural', 'ik-genre-1'],
  ['Survival', 'ik-genre-127'],
  ['Suspense', 'ik-genre-92'],
  ['Team Sports', 'ik-genre-128'],
  ['Teen Boys', 'ik-genre-140'],
  ['Teen Girls', 'ik-genre-139'],
  ['Thriller', 'ik-genre-17'],
  ['Time Travel', 'ik-genre-129'],
  ['TL (Teens\' Love)', 'ik-genre-88'],
  ['Vampires', 'ik-genre-22'],
  ['Video Game', 'ik-genre-131'],
  ['Villainess', 'ik-genre-132'],
  ['Visual Arts', 'ik-genre-133'],
  ['Workplace', 'ik-genre-134'],
  ['Xuanhuan', 'ik-genre-34'],
  ['Yaoi', 'ik-genre-14'],
  ['Yuri', 'ik-genre-39'],
  ['Zombies', 'ik-genre-153'],
] as const;

function genreIdForName(name: string): string | null {
  const lower = name.toLowerCase().trim();
  for (const [display, id] of GENRES) {
    if (display.toLowerCase() === lower) return id;
  }
  return null;
}

// ---------- DTOs ----------
interface FilteredResponse {
  code: number;
  data: string[];
}

interface TitleDto {
  oid: string;
  name: string;
  thumbnailImage?: string | null;
  releaseStatus?: string | null;
  styleOrigin?: string | null;
  keyGenreList: string[];
  summary: string[];
  pageReadCount: number;
  latestChapterFirstPublishedDate?: string | null;
  chapterList: string[];
  titleCreators: Array<{ creator: string; role?: string }>;
  isExplicit: boolean;
  monetizationType?: string | null;
  isAvailable: boolean;
  isRemovedFromSale: boolean;
}

interface NamedDto {
  oid: string;
  name: string;
  url?: string | null;
}

interface ChapterDto {
  oid: string;
  name: string;
  order: number;
  firstPublishedDate?: string | null;
  publishedDate?: string | null;
  revenueType?: string | null;
  coinPrice: number;
  isPurchasedByCoin: boolean;
  isPurchasedBySub: boolean;
}

interface ChapterPagesDto {
  chapterPages: Array<{ page: string | null; url: string }>;
}

interface ContentMapResponse {
  code: number;
  data: Record<string, unknown>;
}

// ---------- Helpers ----------
function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  return isNaN(t) ? undefined : t;
}

function toMangaStatus(value: string | null | undefined): MangaStatus {
  switch (value?.toLowerCase()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    case 'hiatus': return 3;
    default: return 0;
  }
}

function isFreeChapter(dto: ChapterDto): boolean {
  const t = dto.revenueType?.toLowerCase();
  return t === 'ad' || t === 'free';
}

function isAccessible(dto: ChapterDto, isSubscriber: boolean): boolean {
  if (isFreeChapter(dto) || dto.isPurchasedByCoin || dto.isPurchasedBySub) return true;
  if (!isSubscriber) return false;
  const t = dto.revenueType?.toLowerCase();
  return t === 'subscription-only' || t === 'mixed';
}

function titleToManga(title: TitleDto, thumbnailUrl: string | null, authors: string | null, genres: string | null): Manga {
  const styleGenre = title.styleOrigin ? title.styleOrigin.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : null;
  const genreParts = [styleGenre, genres].filter((v): v is string => !!v && v.trim().length > 0);
  return {
    title: title.name,
    url: title.oid,
    thumbnailUrl: thumbnailUrl ?? '',
    author: authors ?? undefined,
    artist: authors ?? undefined,
    description: title.summary.join('\n').trim() || undefined,
    genre: genreParts.join(', ') || undefined,
    status: toMangaStatus(title.releaseStatus),
    lang: 'en',
  };
}

export class InkrScraper extends BaseScraper {
  readonly name = 'INKR';
  readonly baseUrl = 'https://comics.inkr.com';
  readonly lang = 'en';

  private get apiHeaders(): Record<string, string> {
    return {
      'User-Agent': 'okhttp/4.9.1',
      'ikc-platform': 'android',
      'cf-ipcountry': 'en-GB',
      Accept: 'application/json',
    };
  }

  // ---------- Low-level API ----------
  private async filterTitleOids(request: Record<string, unknown>): Promise<string[]> {
    const res = await this.client.post<FilteredResponse>(`${QUERY_API}/title/filtered`, request, { headers: this.apiHeaders });
    return (res.data as FilteredResponse).data ?? [];
  }

  private async searchTitleOids(query: string): Promise<string[]> {
    const res = await this.client.post<{ code: number; data: { title: string[] } }>(
      `${QUERY_API}/title/search`,
      { query },
      { headers: this.apiHeaders },
    );
    const body = res.data as unknown as { code: number; data: { title: string[] } };
    return body.data?.title ?? [];
  }

  private async fetchContentMap(oids: string[], fields: string[]): Promise<Record<string, unknown>> {
    if (oids.length === 0) return {};
    const results: Record<string, unknown> = {};
    const chunks: string[][] = [];
    for (let i = 0; i < oids.length; i += BATCH_SIZE) chunks.push(oids.slice(i, i + BATCH_SIZE));
    for (const chunk of chunks) {
      const body = [{ fields, oids: chunk }];
      const res = await this.client.post<ContentMapResponse>(`${CONTENT_API}/content_json/batch`, body, { headers: this.apiHeaders });
      const data = (res.data as ContentMapResponse).data ?? {};
      Object.assign(results, data);
    }
    return results;
  }

  private async fetchNamedMap(oids: string[]): Promise<Record<string, NamedDto>> {
    if (oids.length === 0) return {};
    const raw = await this.fetchContentMap(oids, ['oid', 'name', 'url']);
    const out: Record<string, NamedDto> = {};
    for (const [k, v] of Object.entries(raw)) {
      const dto = v as NamedDto;
      out[k] = dto;
    }
    return out;
  }

  private async hydrateTitles(oids: string[]): Promise<TitleDto[]> {
    if (oids.length === 0) return [];
    const fields = ['oid', 'name', 'thumbnailImage', 'releaseStatus', 'styleOrigin', 'keyGenreList', 'summary', 'pageReadCount', 'latestChapterFirstPublishedDate', 'isExplicit', 'monetizationType', 'isAvailable', 'isRemovedFromSale'];
    const raw = await this.fetchContentMap(oids, fields);
    const map: Record<string, TitleDto> = {};
    for (const [k, v] of Object.entries(raw)) map[k] = v as TitleDto;
    return oids.map(oid => map[oid]).filter((v): v is TitleDto => !!v);
  }

  private async toSMangaList(titles: TitleDto[]): Promise<Manga[]> {
    const imageOids = [...new Set(titles.map(t => t.thumbnailImage).filter((v): v is string => !!v))];
    const images = await this.fetchNamedMap(imageOids);
    const genreOids = [...new Set(titles.flatMap(t => t.keyGenreList))];
    const genres = await this.fetchNamedMap(genreOids);
    return titles.map(title => {
      const thumb = title.thumbnailImage ? images[title.thumbnailImage]?.url ?? null : null;
      const genreStr = title.keyGenreList.map(id => genres[id]?.name).filter((v): v is string => !!v).join(', ') || null;
      return titleToManga(title, thumb, null, genreStr);
    });
  }

  private async browseManga(page: number, query: string, sortMode: 'popular' | 'latest' | 'relevance'): Promise<SearchResult> {
    const trimmed = query.trim();
    const genreId = genreIdForName(trimmed);
    // Build filtered request: no filters -> empty object with limit 10000 upstream default
    // For our port we simply use genre filter if query matches genre
    const filterRequest: Record<string, unknown> = {};
    if (genreId) {
      filterRequest['andGenres'] = [genreId];
    }

    let oids: string[];
    if (genreId) {
      oids = await this.filterTitleOids(filterRequest);
    } else if (trimmed === '') {
      oids = await this.filterTitleOids(filterRequest);
    } else {
      const searchOids = await this.searchTitleOids(trimmed);
      if (Object.keys(filterRequest).length === 0) {
        oids = searchOids;
      } else {
        const allowed = new Set(await this.filterTitleOids(filterRequest));
        oids = searchOids.filter(id => allowed.has(id));
      }
    }

    let titles = await this.hydrateTitles(oids);
    // filter availability same as Kotlin
    titles = titles.filter(t => t.isAvailable && !t.isRemovedFromSale);
    // filter name matches for relevance mode (mirrors upstream)
    if (trimmed !== '' && !genreId) {
      titles = titles.filter(t => t.name.toLowerCase().includes(trimmed.toLowerCase()));
    }

    if (sortMode === 'popular') {
      titles.sort((a, b) => b.pageReadCount - a.pageReadCount);
    } else if (sortMode === 'latest') {
      titles.sort((a, b) => (b.latestChapterFirstPublishedDate ?? '').localeCompare(a.latestChapterFirstPublishedDate ?? ''));
    }
    // relevance keeps search order

    const from = (page - 1) * PAGE_SIZE;
    if (from >= titles.length) return { mangas: [], hasNextPage: false };
    const slice = titles.slice(from, from + PAGE_SIZE);
    const mangas = await this.toSMangaList(slice);
    return { mangas, hasNextPage: from + PAGE_SIZE < titles.length };
  }

  // ---------- BaseScraper contract ----------
  async getPopular(page = 1): Promise<SearchResult> {
    return this.browseManga(page, '', 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browseManga(page, '', 'latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    const mode: 'popular' | 'relevance' = trimmed === '' || genreIdForName(trimmed) !== null ? 'popular' : 'relevance';
    return this.browseManga(page, query, mode);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const oid = mangaUrl.includes('ik-title-') ? mangaUrl : mangaUrl.split('/').pop() ?? mangaUrl;
    const normalized = oid.startsWith('ik-title-') ? oid : `ik-title-${oid.replace(/\D/g, '')}`;
    // If mangaUrl is already oid like ik-title-3111
    const fields = ['oid', 'name', 'thumbnailImage', 'releaseStatus', 'styleOrigin', 'keyGenreList', 'summary', 'pageReadCount', 'latestChapterFirstPublishedDate', 'isExplicit', 'monetizationType', 'isAvailable', 'isRemovedFromSale', 'chapterList', 'titleCreators'];
    const raw = await this.fetchContentMap([normalized], fields);
    const dto = raw[normalized] as TitleDto | undefined;
    if (!dto) return { url: mangaUrl, lang: this.lang };
    const image = dto.thumbnailImage ? (await this.fetchNamedMap([dto.thumbnailImage]))[dto.thumbnailImage]?.url ?? null : null;
    const creators = await this.fetchNamedMap(dto.titleCreators.map(c => c.creator));
    const authors = dto.titleCreators.map(c => creators[c.creator]?.name).filter((v): v is string => !!v).join(', ') || null;
    const genreMap = await this.fetchNamedMap(dto.keyGenreList);
    const genres = dto.keyGenreList.map(id => genreMap[id]?.name).filter((v): v is string => !!v).join(', ') || null;
    const manga = titleToManga(dto, image, authors, genres);
    return { ...manga, url: dto.oid };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const oid = mangaUrl.includes('ik-title-') ? mangaUrl : `ik-title-${mangaUrl.split('/').pop()?.replace(/\D/g, '') ?? ''}`;
    const normalized = oid.startsWith('ik-title-') ? oid : `ik-title-${mangaUrl}`;
    const fields = ['oid', 'chapterList'];
    const raw = await this.fetchContentMap([normalized], fields);
    const dto = raw[normalized] as unknown as { chapterList: string[] } | undefined;
    if (!dto || !dto.chapterList?.length) return [];
    const chapterFields = ['oid', 'name', 'order', 'firstPublishedDate', 'publishedDate', 'revenueType', 'coinPrice', 'isPurchasedByCoin', 'isPurchasedBySub'];
    const chapterMapRaw = await this.fetchContentMap(dto.chapterList, chapterFields);
    // Anonymous: isSubscriber false
    const chapters: Chapter[] = [];
    for (const chapterOid of dto.chapterList) {
      const ch = chapterMapRaw[chapterOid] as ChapterDto | undefined;
      if (!ch) continue;
      const accessible = isAccessible(ch, false);
      const locked = !accessible ? '🔒 ' : '';
      chapters.push({
        name: `${locked}${ch.name}`,
        url: ch.oid,
        chapterNumber: ch.order,
        dateUpload: parseDate(ch.firstPublishedDate ?? ch.publishedDate),
      });
    }
    // Kotlin sorts by order descending
    chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const oid = chapterUrl.includes('ik-chapter-') ? chapterUrl : `ik-chapter-${chapterUrl.split('/').pop()?.replace(/\D/g, '') ?? chapterUrl}`;
    const normalized = oid.startsWith('ik-chapter-') ? oid : chapterUrl;
    const raw = await this.fetchContentMap([normalized], ['chapterPages']);
    // The second form with includes is required for page URLs in Kotlin; but we try simple then fallback
    // First attempt simple fetch
    let pagesDto = raw[normalized] as unknown as ChapterPagesDto | undefined;
    // If not present, try batch with includes (requires different body shape). For TS we mimic by requesting with includes via manual POST
    if (!pagesDto || !pagesDto.chapterPages) {
      // Re-try with includes structure
      const body = [{
        fields: ['chapterPages'],
        oids: [normalized],
        includes: { chapterPages: { fields: ['oid', 'width', 'height', 'type'], includes: {}, includeKey: 'page' } },
      }];
      const res = await this.client.post<ContentMapResponse>(`${CONTENT_API}/content_json/batch`, body, { headers: this.apiHeaders });
      const data = (res.data as ContentMapResponse).data ?? {};
      const fallback = data[normalized] as unknown as ChapterPagesDto | undefined;
      if (fallback) pagesDto = fallback;
    }
    if (!pagesDto || !Array.isArray(pagesDto.chapterPages)) return [];
    return pagesDto.chapterPages.map((p, index) => ({
      index,
      imageUrl: `${p.url.replace(/\/$/, '')}/${IMAGE_VARIANT}`,
    }));
  }
}
