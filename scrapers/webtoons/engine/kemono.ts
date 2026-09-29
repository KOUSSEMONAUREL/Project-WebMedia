import { BaseScraper } from './base';
import type { Manga, Chapter, Page, SearchResult } from './types';

// ============================================================
// KemonoScraper — TS transcompilation of Keiyoushi lib-multisrc
// "kemono" (Kemono.kt + KemonoDto.kt, libVersion 1.6).
// Kemono / Coomer are API-driven: creators API for listings,
// posts API (50 posts/page, ?o= offset) for chapters, and the
// wrapped post endpoint for pages. Attachments + file → images.
// Kotlin preferences simplified to TS defaults: maxPostPages = 1
// (POST_PAGES default "1"), useLowResImages = false.
// ============================================================

const API_PATH = 'api/v1';
const DATA_PATH = 'data';
const PAGE_POST_LIMIT = 50;
const PAGE_CREATORS_LIMIT = 50;
const POST_PAGES_MAX = 75;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'gif', 'jpeg', 'webp']);


interface KemonoCreatorDto {
  id: string;
  name: string;
  service: string;
  indexed?: number;
  updated: string | number;
  favorited?: number;
}

interface KemonoFileDto {
  name?: string | null;
  path?: string | null;
}

interface KemonoAttachmentDto {
  name?: string | null;
  path: string;
}

interface KemonoPostDto {
  id: string;
  service: string;
  user: string;
  title: string;
  added?: string | null;
  published?: string | null;
  edited?: string | null;
  file: KemonoFileDto;
  attachments: KemonoAttachmentDto[];
}

interface KemonoPostDtoWrapped {
  post: KemonoPostDto;
}

type KemonoSortKey = 'pop' | 'tit' | 'new' | 'lat';

function serviceName(service: string): string {
  switch (service) {
    case 'fanbox': return 'Pixiv Fanbox';
    case 'subscribestar': return 'SubscribeStar';
    case 'dlsite': return 'DLsite';
    case 'onlyfans': return 'OnlyFans';
    default: return service.charAt(0).toUpperCase() + service.slice(1);
  }
}

function creatorUpdatedDate(updated: string | number): number {
  if (typeof updated === 'string') {
    const ms = Date.parse(updated);
    return isNaN(ms) ? 0 : ms;
  }
  return updated * 1000;
}

function parsePostDate(value: string | null | undefined, zoneOffsetHours: number): number {
  if (!value) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (m) {
    const [, y, mo, d, h, mi, s] = m.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, s) - zoneOffsetHours * 3_600_000;
  }
  const ms = Date.parse(value);
  return isNaN(ms) ? 0 : ms;
}

function formatPostDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} at ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function postImages(post: KemonoPostDto): string[] {
  const all: KemonoAttachmentDto[] = [];
  if (post.file && post.file.path) {
    all.push({ name: post.file.name, path: post.file.path });
  }
  all.push(...post.attachments);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const att of all) {
    const ext = att.path.substring(att.path.lastIndexOf('.') + 1).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    if (seen.has(att.path)) continue;
    seen.add(att.path);
    out.push(att.path + (att.name != null ? `?f=${att.name}` : ''));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export abstract class KemonoScraper extends BaseScraper {
  override readonly name: string;
  override readonly baseUrl: string;
  override readonly lang: string;

  protected readonly serviceTypes: string[] = [];
  protected maxPostPages = 1;
  // Les fichiers pleine taille renvoient un 302 vers les serveurs de
  // fichiers nX, qui sont souvent injoignables (TCP 443 bloque): upstream
  // installe un thumbnailFallbackInterceptor qui rebascule sur /thumbnail
  // quand la requete echoue. On passe donc par defaut par ce chemin, la
  // variante `useLowResImages` existant dans le moteur restant le point de
  // bascule pour un site ou le full-size serait joignable.
  protected useLowResImages = true;

  constructor(name: string, baseUrl: string, lang: string) {
    super();
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lang = lang;
  }

  protected get imgCdnUrl(): string {
    return this.baseUrl.replace('//', '//img.');
  }

  protected get apiHeaders(): Record<string, string> {
    return { Accept: 'text/css' };
  }

  getSupportedServices(): string[] {
    return [...this.serviceTypes];
  }

  protected creatorToManga(dto: KemonoCreatorDto): Manga {
    return {
      title: dto.name,
      url: `/${dto.service}/user/${dto.id}`,
      thumbnailUrl: `${this.imgCdnUrl}/icons/${dto.service}/${dto.id}`,
      lang: this.lang,
      author: serviceName(dto.service),
      description: 'You can change how many posts to load in the extension preferences.',
    };
  }

  protected sortCreators(dtos: KemonoCreatorDto[], sort: KemonoSortKey, descending: boolean): KemonoCreatorDto[] {
    const dir = descending ? -1 : 1;
    return [...dtos].sort((a, b) => {
      switch (sort) {
        case 'pop': return ((a.favorited ?? -1) - (b.favorited ?? -1)) * dir;
        case 'tit': return (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) * dir;
        case 'new': return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * dir;
        case 'lat':
        default: return (creatorUpdatedDate(a.updated) - creatorUpdatedDate(b.updated)) * dir;
      }
    });
  }

  // La liste des createurs pese 3,4 a 5,9 Mo et ne change pas pendant une
  // session. Elle etait retelechargee a chaque getChapterList et
  // getMangaDetails: on la telecharge une fois.
  private creatorsPromise: Promise<KemonoCreatorDto[]> | null = null;

  protected fetchCreators(): Promise<KemonoCreatorDto[]> {
    this.creatorsPromise ??= this.loadCreators();
    return this.creatorsPromise;
  }

  private async loadCreators(): Promise<KemonoCreatorDto[]> {
    const res = await this.get(`${this.baseUrl}/${API_PATH}/creators`, { headers: this.apiHeaders });
    const all = res.data as KemonoCreatorDto[];
    const allowed = new Set(this.serviceTypes.map(t => t.toLowerCase()));
    return all.filter(dto => {
      if (dto.service.toLowerCase() === 'discord') return false;
      if (allowed.size > 0 && !allowed.has(serviceName(dto.service).toLowerCase())) return false;
      return true;
    });
  }

  protected async searchMangas(page: number, title = '', sort: KemonoSortKey = 'pop', descending = true): Promise<SearchResult> {
    const creators = await this.fetchCreators();
    const query = title.toLowerCase();
    const filtered = creators.filter(dto => dto.name.toLowerCase().includes(query));
    const sorted = this.sortCreators(filtered, sort, descending);
    const fromIndex = (page - 1) * PAGE_CREATORS_LIMIT;
    if (fromIndex >= sorted.length) return { mangas: [], hasNextPage: false };
    const toIndex = Math.min(sorted.length, fromIndex + PAGE_CREATORS_LIMIT);
    return {
      mangas: sorted.slice(fromIndex, toIndex).map(dto => this.creatorToManga(dto)),
      hasNextPage: toIndex !== sorted.length,
    };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchMangas(page, '', 'pop', true);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchMangas(page, '', 'lat', true);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const creatorPath = /^https?:\/\/[^/]+\/([^/]+)\/user\/([^/?#]+)/.exec(query.trim());
    if (creatorPath) {
      const [, service, id] = creatorPath;
      const creators = await this.fetchCreators();
      const found = creators.find(dto => dto.service === service && dto.id === id);
      if (found) return { mangas: [this.creatorToManga(found)], hasNextPage: false };
      return { mangas: [], hasNextPage: false };
    }
    return this.searchMangas(page, query, 'pop', true);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const m = /\/([^/]+)\/user\/([^/?#]+)/.exec(mangaUrl);
    if (!m) return { title: '', url: mangaUrl, thumbnailUrl: '', lang: this.lang };
    const [, service, id] = m;
    const creators = await this.fetchCreators();
    const found = creators.find(dto => dto.service === service && dto.id === id);
    if (!found) return { title: '', url: mangaUrl, thumbnailUrl: '', lang: this.lang };
    return this.creatorToManga(found);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const m = /\/([^/]+)\/user\/([^/?#]+)/.exec(mangaUrl);
    if (!m) return [];
    const [, service, userId] = m;
    const creators = await this.fetchCreators();
    const creator = creators.find(dto => dto.service === service && dto.id === userId);
    const author = creator ? serviceName(creator.service) : '';
    const zoneOffsetHours = author === 'Pixiv Fanbox' || author === 'Fantia' ? 9 : 0;
    const maxPosts = Math.min(this.maxPostPages, POST_PAGES_MAX) * PAGE_POST_LIMIT;
    const chapters: Chapter[] = [];
    let offset = 0;
    let hasNextPage = true;
    while (offset < maxPosts && hasNextPage) {
      const posts = await this.fetchPosts(service, userId, offset);
      for (const post of posts) {
        if (postImages(post).length === 0) continue;
        chapters.push(this.postToChapter(post, zoneOffsetHours));
      }
      offset += PAGE_POST_LIMIT;
      hasNextPage = posts.length === PAGE_POST_LIMIT;
    }
    return chapters;
  }

  protected async fetchPosts(service: string, userId: string, offset: number): Promise<KemonoPostDto[]> {
    const url = `${this.baseUrl}/${API_PATH}/${service}/user/${userId}/posts?o=${offset}`;
    let code = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await this.get(url, {
        headers: this.apiHeaders,
        validateStatus: (status: number) => true,
      });
      code = res.status;
      if (res.status >= 200 && res.status < 300) return res.data as KemonoPostDto[];
      if (res.status === 429) {
        await sleep(10000);
        continue;
      }
      break;
    }
    throw new Error(`${this.name}: failed to fetch posts (HTTP ${code})`);
  }

  protected postToChapter(post: KemonoPostDto, zoneOffsetHours: number): Chapter {
    const postDate = parsePostDate(post.edited ?? post.published ?? post.added, zoneOffsetHours);
    const name = post.title.trim() !== ''
      ? post.title
      : `Post from ${postDate !== 0 ? formatPostDate(postDate) : 'unknown date'}`;
    return {
      name,
      url: `/${post.service}/user/${post.user}/post/${post.id}`,
      chapterNumber: -2,
      dateUpload: postDate || undefined,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const m = /\/([^/]+)\/user\/([^/]+)\/post\/([^/?#]+)/.exec(chapterUrl);
    if (!m) return [];
    const [, service, userId, postId] = m;
    const res = await this.get(
      `${this.baseUrl}/${API_PATH}/${service}/user/${userId}/post/${postId}`,
      { headers: this.apiHeaders },
    );
    const wrapped = res.data as KemonoPostDtoWrapped;
    return postImages(wrapped.post).map((path, index) => ({
      index,
      imageUrl: this.resolveImageUrl(`${this.baseUrl}/${DATA_PATH}${path}`),
    }));
  }

  protected resolveImageUrl(imageUrl: string): string {
    if (!this.useLowResImages) return imageUrl;
    const index = imageUrl.indexOf('/', 8);
    if (index < 0) return imageUrl;
    return `${imageUrl.substring(0, index)}/thumbnail${imageUrl.substring(index)}`;
  }
}
