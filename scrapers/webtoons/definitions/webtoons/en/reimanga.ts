import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const BASE_URL = 'https://reimanga.net';
const BROWSE_LIMIT = 24;
const TRENDING_LIMIT = 100;
const ADULT_COOKIE = 'showAdultContent=true';

// ============================= DTOs =============================

interface MangaDto {
  id: number;
  name_url: string;
  title: string;
  cover_url?: string | null;
}

interface MangaListDto {
  data?: MangaDto[] | null;
  initialData?: MangaDto[] | null;
  pagination?: PaginationDto | null;
}

interface PaginationDto {
  currentPage: number;
  totalPages: number;
}

interface TagDto {
  name?: string | null;
}

interface AuthorDto {
  name?: string | null;
}

interface MangaDetailsDto extends MangaDto {
  description?: string | null;
  ai_description?: string | null;
  alt_title?: string | null;
  completed?: number | null;
  rating?: number | null;
  is_adult?: number | null;
  genres?: TagDto[] | null;
  tags?: TagDto[] | null;
  authors?: AuthorDto[] | null;
  main_manga_id?: number | null;
  main_name_url?: string | null;
}

interface MangaPageDto {
  manga: MangaDetailsDto;
}

interface ChapterListItemDto {
  id: number;
  name?: string | null;
  gdrive_upload_date?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

interface ChapterListDto {
  manga: {
    id: number;
    name_url: string;
  };
  chapters: ChapterListItemDto[];
}

interface ImagesDto {
  images: { image_url?: string | null }[];
}

// ======================= Next.js RSC parsing =======================
// Transcompilation of keiyoushi/utils/NextJs.kt (String.extractNextJsRsc subset)

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface RscContext {
  chunks: Map<string, string>;
  models: Map<string, JsonValue>;
}

function isHexId(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

function utf8AwareAdvance(body: string, start: number, byteLen: number): number {
  let bytes = 0;
  let pos = start;
  while (pos < body.length && bytes < byteLen) {
    const code = body.charCodeAt(pos);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      pos++;
    } else bytes += 3;
    pos++;
  }
  return pos;
}

function parseJsonAt(body: string, start: number): { value: JsonValue | null; end: number } {
  let depth = 0;
  let inString = false;
  let escape = false;
  let i = start;
  while (i < body.length) {
    const c = body[i++];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        try {
          return { value: JSON.parse(body.substring(start, i)) as JsonValue, end: i };
        } catch {
          return { value: null, end: i };
        }
      }
    }
  }
  return { value: null, end: i };
}

function extractRscPayloads(body: string, ctx: RscContext): JsonValue[] {
  const results: JsonValue[] = [];
  let pos = 0;
  while (pos < body.length) {
    const colonIdx = body.indexOf(':', pos);
    if (colonIdx === -1) break;
    const id = body.substring(pos, colonIdx);
    if (id.length === 0 || !isHexId(id)) {
      pos++;
      continue;
    }
    pos = colonIdx + 1;
    if (pos >= body.length) break;
    if (body[pos] === 'T') {
      pos++;
      const commaIdx = body.indexOf(',', pos);
      if (commaIdx === -1) break;
      const byteLen = parseInt(body.substring(pos, commaIdx), 16);
      if (isNaN(byteLen)) break;
      pos = commaIdx + 1;
      const start = pos;
      pos = utf8AwareAdvance(body, start, byteLen);
      const content = body.substring(start, pos);
      ctx.chunks.set(id, content);
      try {
        results.push(JSON.parse(content) as JsonValue);
      } catch {}
    } else {
      const { value, end } = parseJsonAt(body, pos);
      if (value !== null) {
        results.push(value);
        ctx.models.set(id, value);
      }
      pos = end;
    }
  }
  return results;
}

function walkRefSegment(value: JsonValue, segment: string): JsonValue | null {
  if (Array.isArray(value)) {
    if (value.length >= 4 && value[0] === '$') {
      switch (segment) {
        case 'type':
          return value[1] ?? null;
        case 'key':
          return value[2] ?? null;
        case 'props':
          return value[3] ?? null;
      }
    }
    const index = Number.parseInt(segment, 10);
    return Number.isNaN(index) ? null : value[index] ?? null;
  }
  if (value !== null && typeof value === 'object') {
    return value[segment] ?? null;
  }
  return null;
}

function resolveModelRef(reference: string, ctx: RscContext, resolving: Set<string>): JsonValue | null {
  const segments = reference.split(':');
  const id = segments[0];
  if (segments.length === 1) {
    const chunk = ctx.chunks.get(id);
    if (chunk !== undefined) return chunk;
  }
  if (resolving.has(id)) return null;
  const guard = new Set(resolving);
  guard.add(id);
  let value: JsonValue | null = ctx.models.get(id) ?? null;
  if (value === null) return null;
  for (let i = 1; i < segments.length; i++) {
    if (typeof value === 'string' && value.startsWith('$')) {
      value = resolveNextJsRefs(value, ctx, guard);
      if (value === null) return null;
    }
    value = walkRefSegment(value, segments[i]);
    if (value === null) return null;
  }
  return resolveNextJsRefs(value, ctx, guard);
}

function resolveMapRef(id: string, ctx: RscContext, resolving: Set<string>): JsonValue | null {
  if (resolving.has(id)) return null;
  const entries = ctx.models.get(id);
  if (!Array.isArray(entries)) return null;
  const resolved = resolveNextJsRefs(entries, ctx, new Set([...resolving, id]));
  if (!Array.isArray(resolved)) return null;
  const out: { [key: string]: JsonValue } = {};
  for (const pair of resolved) {
    if (Array.isArray(pair) && pair.length === 2) {
      out[String(pair[0])] = pair[1];
    }
  }
  return out;
}

function resolveSetRef(id: string, ctx: RscContext, resolving: Set<string>): JsonValue | null {
  if (resolving.has(id)) return null;
  const values = ctx.models.get(id);
  if (!Array.isArray(values)) return null;
  return resolveNextJsRefs(values, ctx, new Set([...resolving, id]));
}

function resolveNextJsRefs(element: JsonValue, ctx: RscContext, resolving: Set<string>): JsonValue {
  if (Array.isArray(element)) return element.map((item) => resolveNextJsRefs(item, ctx, resolving));
  if (element !== null && typeof element === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(element)) {
      out[k] = resolveNextJsRefs(v, ctx, resolving);
    }
    return out;
  }
  if (typeof element !== 'string' || !element.startsWith('$') || element.length < 2) {
    return element;
  }
  if (element === '$undefined') return null;
  if (element === '$Infinity' || element === '$-Infinity' || element === '$NaN' || element === '$-0') {
    return element.substring(1);
  }
  switch (element[1]) {
    case '$':
      return element.substring(1);
    case 'D':
    case 'n':
      return element.substring(2);
    case 'Q':
      return resolveMapRef(element.substring(2), ctx, resolving) ?? element;
    case 'W':
      return resolveSetRef(element.substring(2), ctx, resolving) ?? element;
    default:
      return resolveModelRef(element.substring(1), ctx, resolving) ?? element;
  }
}

function findNextJsValue(node: JsonValue, hasRequiredKeys: (o: { [key: string]: JsonValue }) => boolean): JsonValue | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNextJsValue(item, hasRequiredKeys);
      if (found !== null) return found;
    }
    return null;
  }
  if (node !== null && typeof node === 'object') {
    if (hasRequiredKeys(node)) return node;
    for (const v of Object.values(node)) {
      const found = findNextJsValue(v, hasRequiredKeys);
      if (found !== null) return found;
    }
  }
  return null;
}

function extractNextJsRsc<T>(
  body: string,
  hasRequiredKeys: (o: { [key: string]: JsonValue }) => boolean,
): T | null {
  const ctx: RscContext = { chunks: new Map(), models: new Map() };
  for (const payload of extractRscPayloads(body, ctx)) {
    const resolved = resolveNextJsRefs(payload, ctx, new Set());
    const found = findNextJsValue(resolved, hasRequiredKeys);
    if (found !== null) return found as unknown as T;
  }
  return null;
}

// ============================= Scraper =============================

function parseDate(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return isNaN(time) ? undefined : time;
}

export class ReimangaScraper extends BaseScraper {
  readonly name = 'ReiManga';
  readonly baseUrl = BASE_URL;
  readonly lang = 'en';

  constructor() {
    super();
    this.client.defaults.headers.common.Cookie = ADULT_COOKIE;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) {
      return this.browse(page - 1, 'viewed');
    }
    const res = await this.get(`/api/manga/trending?limit=${TRENDING_LIMIT}`);
    const data = this.toJson(res.data) as MangaDto[] | null;
    return {
      mangas: (Array.isArray(data) ? data : []).map((m) => this.toManga(m)),
      hasNextPage: true,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.browse(page, 'latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.browse(page, 'latest', query.trim());
  }

  private async browse(page: number, sort: string, search?: string): Promise<SearchResult> {
    const url = new URL(`${BASE_URL}/api/manga`);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('limit', BROWSE_LIMIT.toString());
    if (search) url.searchParams.set('search', search);
    url.searchParams.set('sort', sort);
    url.searchParams.set('order', 'desc');

    const res = await this.get(url.toString());
    const data = this.toJson(res.data) as MangaListDto;
    const items = data?.data ?? data?.initialData ?? [];
    const current = data?.pagination?.currentPage ?? page;
    const total = data?.pagination?.totalPages ?? page;
    return {
      mangas: items.map((m) => this.toManga(m)),
      hasNextPage: current < total,
    };
  }

  private toManga(dto: MangaDto): Manga {
    return {
      title: dto.title,
      url: `${dto.name_url}-${dto.id}`,
      thumbnailUrl: dto.cover_url || `${BASE_URL}/covers/${dto.id}/thumbnail.png`,
      lang: this.lang,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const apiManga = await this.fetchResolvedManga(this.requestIdFromUrl(mangaUrl));
    const dto = apiManga.manga;

    const descriptionParts: string[] = [];
    const rating = dto.rating ?? -1;
    if (rating > 0) {
      const filled = Math.max(0, Math.min(5, Math.round(rating / 2)));
      descriptionParts.push('★'.repeat(filled) + '☆'.repeat(5 - filled));
      descriptionParts.push(String(rating));
    }
    const synopsis = (dto.ai_description ?? dto.description)?.trim();
    if (synopsis) descriptionParts.push(synopsis);
    const altTitle = dto.alt_title?.trim();
    if (altTitle) {
      descriptionParts.push(
        'Alternative Titles:\n' +
          altTitle
            .split(/[,;]/)
            .map((title) => `- ${title.trim()}`)
            .join('\n'),
      );
    }

    const status: MangaStatus = dto.completed === 1 ? 0 : 1;
    const genreParts: string[] = [];
    if (dto.is_adult === 1) genreParts.push('Adult');
    dto.genres?.forEach((tag) => {
      const name = tag.name?.trim();
      if (name) genreParts.push(name);
    });
    dto.tags?.forEach((tag) => {
      const name = tag.name?.trim();
      if (name) genreParts.push(name);
    });
    const authors = (dto.authors ?? [])
      .map((author) => author.name?.trim().replace(/,$/, '').trim())
      .filter((name): name is string => !!name);

    return {
      title: dto.title,
      url: mangaUrl,
      thumbnailUrl: dto.cover_url || `${BASE_URL}/covers/${dto.id}/thumbnail.png`,
      description: descriptionParts.join('\n\n').trim() || undefined,
      status,
      author: authors.join(', ') || undefined,
      genre: genreParts.join(', ') || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const apiManga = await this.fetchResolvedManga(this.requestIdFromUrl(mangaUrl));
    const dto = apiManga.manga;

    const res = await this.get(this.chapterPagePath(dto), { headers: { RSC: '1' } });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const chapterList = extractNextJsRsc<ChapterListDto>(
      body,
      (o) => 'manga' in o && 'chapters' in o,
    );
    if (!chapterList) return [];

    const mangaSlug = `${chapterList.manga.name_url}-${chapterList.manga.id}`;
    return (chapterList.chapters ?? []).map((chapter) => ({
      name: (chapter.name ?? '').replace(/\s+/g, ' ').trim(),
      url: `/manga/${mangaSlug}/${chapter.id}`,
      dateUpload:
        parseDate(chapter.gdrive_upload_date) ??
        parseDate(chapter.updated_at) ??
        parseDate(chapter.created_at),
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl, { headers: { RSC: '1' } });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const images = extractNextJsRsc<ImagesDto>(body, (o) => 'images' in o);
    if (!images) return [];
    return (images.images ?? [])
      .map((image) => image.image_url ?? '')
      .filter((url) => url.length > 0)
      .map((imageUrl, index) => ({
        index,
        imageUrl: imageUrl.startsWith('http') ? imageUrl : this.absUrl(imageUrl),
      }));
  }

  // =========================== Helpers ===========================

  private toJson(data: unknown): unknown {
    return typeof data === 'string' ? JSON.parse(data) : data;
  }

  /**
   * DMCA / duplicate entries point at a main series holding the real metadata and chapters.
   */
  private async fetchResolvedManga(requestId: number): Promise<MangaPageDto> {
    let apiManga = await this.fetchManga(requestId);
    const resolvedId = apiManga.manga.main_manga_id != null && apiManga.manga.main_manga_id > 0
      ? apiManga.manga.main_manga_id
      : apiManga.manga.id;
    if (resolvedId !== requestId) {
      apiManga = await this.fetchManga(resolvedId);
    }
    return apiManga;
  }

  private async fetchManga(id: number): Promise<MangaPageDto> {
    const res = await this.get(`/api/manga/${id}`);
    return this.toJson(res.data) as MangaPageDto;
  }

  private requestIdFromUrl(mangaUrl: string): number {
    const slug = mangaUrl.replace(/\/$/, '').split('/').pop() ?? '';
    return Number.parseInt(slug.substring(slug.lastIndexOf('-') + 1), 10);
  }

  private chapterPagePath(dto: MangaDetailsDto): string {
    if (
      dto.main_manga_id != null &&
      dto.main_manga_id > 0 &&
      dto.main_name_url != null &&
      dto.main_name_url.trim().length > 0
    ) {
      return `/manga/${dto.main_name_url}-${dto.main_manga_id}`;
    }
    return `/manga/${dto.name_url}-${dto.id}`;
  }
}
