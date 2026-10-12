import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const j = (d: unknown) => typeof d === 'string' ? JSON.parse(d as string) as unknown : d;
const BROWSE_LIMIT = 40;
const CDN_ORIGIN = 'https://cdn.atsu.moe';

type BrowseItem = {
  id?: string;
  title?: string;
  image?: string;
  poster?: string;
  posterSmall?: string;
  posterMedium?: string;
};

export class AtsumaruScraper extends BaseScraper {
  readonly name = 'Atsumaru';
  readonly baseUrl = 'https://atsu.moe';
  readonly lang = 'en';

  /**
   * Les fichiers sont servis par `cdn.atsu.moe`, pas par le domaine applicatif :
   * `https://atsu.moe/static/...` repond 410/301 alors que `cdn.atsu.moe` repond 200.
   */
  private mediaUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return `${CDN_ORIGIN}/static/${path.replace(/^\/+/, '').replace(/^static\//, '')}`;
  }

  private mangaUrl(id: string): string {
    return `/manga/${id}`;
  }

  private mapBrowseItems(data: unknown): Manga[] {
    const raw = j(data) as { items?: BrowseItem[]; manga?: BrowseItem[] };
    const list = raw.items ?? raw.manga ?? [];
    return list
      .filter((item): item is BrowseItem & { id: string } => typeof item.id === 'string' && item.id.length > 0)
      .map(item => ({
        title: item.title ?? '',
        url: this.mangaUrl(item.id),
        thumbnailUrl: this.mediaUrl(item.image ?? item.posterSmall ?? item.posterMedium ?? item.poster ?? ''),
        lang: this.lang,
      }));
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * BROWSE_LIMIT;
    const res = await this.get(`${this.baseUrl}/api/home2/popular?offset=${offset}&limit=${BROWSE_LIMIT}&types=Manga,Manwha,Manhua,OEL&mediums=Comic&timeframe=daily`);
    return { mangas: this.mapBrowseItems(j(res.data)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * BROWSE_LIMIT;
    const res = await this.get(`${this.baseUrl}/api/home2/recentlyUpdated?offset=${offset}&limit=${BROWSE_LIMIT}&types=Manga,Manwha,Manhua,OEL&mediums=Comic`);
    return { mangas: this.mapBrowseItems(j(res.data)), hasNextPage: false };
  }

  /**
   * La recherche passe par Typesense, expose tel quel sous `/collections/manga/documents/search`.
   * Requete en JSON simple, sans signature ni cle d'API.
   */
  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({
      q: query,
      query_by: 'title,englishTitle,otherNames,authors,acronyms',
      per_page: String(BROWSE_LIMIT),
      page: String(page),
    });
    const res = await this.get(`${this.baseUrl}/collections/manga/documents/search?${params.toString()}`);
    const raw = j(res.data) as { hits?: { document?: BrowseItem }[] };
    const mangas = (raw.hits ?? [])
      .map(hit => hit.document)
      .filter((doc): doc is BrowseItem & { id: string } => !!doc && typeof doc.id === 'string' && doc.id.length > 0)
      .map(doc => ({
        title: doc.title ?? '',
        url: this.mangaUrl(doc.id),
        thumbnailUrl: this.mediaUrl(doc.posterSmall ?? doc.posterMedium ?? doc.poster ?? ''),
        lang: this.lang,
      }));
    const found = raw.hits?.length ?? 0;
    return { mangas, hasNextPage: page * BROWSE_LIMIT < found };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.idFromUrl(mangaUrl);
    const res = await this.get(`${this.baseUrl}/api/manga/page?id=${encodeURIComponent(id)}`);
    const raw = j(res.data) as { mangaPage?: Record<string, unknown> };
    const mp = raw.mangaPage ?? {};
    const description = (mp['description'] ?? mp['summary'] ?? '') as string;
    // `authors` est une liste d'objets { id, name }, pas une liste de chaines.
    const authors = Array.isArray(mp['authors'])
      ? (mp['authors'] as { name?: string }[]).map(a => a?.name ?? '').filter(Boolean)
      : [];
    // `poster` est un objet { id, image, ... } ; les variantes scalaires ne servent que de repli.
    const poster = mp['poster'];
    const posterPath = typeof poster === 'object' && poster !== null
      ? ((poster as { image?: string; small?: string; medium?: string }).image ?? (poster as { id?: string }).id ?? '')
      : (typeof poster === 'string' ? poster : (mp['posterMedium'] as string) ?? '');
    const statusText = (mp['status'] as string | undefined) ?? '';
    const status: MangaStatus = statusText === 'Completed' ? 0 : statusText === 'Ongoing' ? 1 : 3;
    return {
      title: (mp['title'] as string) ?? '',
      url: mangaUrl,
      thumbnailUrl: this.mediaUrl(posterPath),
      description: description.replace(/<[^>]*>/g, '').trim() || undefined,
      author: authors.length > 0 ? authors.join(', ') : undefined,
      status,
      lang: this.lang,
    };
  }

  /**
   * Les chapitres viennent de `allChapters`, et non de la page de serie.
   * `mangaPage.chapters` est plafonne a 100 et pagine a part.
   */
  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.idFromUrl(mangaUrl);
    const res = await this.get(`${this.baseUrl}/api/manga/allChapters?mangaId=${encodeURIComponent(id)}`);
    const raw = j(res.data) as { chapters?: Record<string, unknown>[] };
    return (raw.chapters ?? []).map(ch => {
      const createdAt = ch['createdAt'] as number | undefined;
      return {
        name: (ch['title'] as string) ?? `Chapter ${ch['number'] ?? ''}`,
        url: `${this.mangaUrl(id)}/read/${ch['id']}`,
        chapterNumber: ch['number'] as number | undefined,
        dateUpload: typeof createdAt === 'number' ? createdAt : undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const ids = this.chapterIdsFromUrl(chapterUrl);
    const params = new URLSearchParams({ mangaId: ids.mangaId, chapterId: ids.chapterId });
    const res = await this.get(`${this.baseUrl}/api/read/chapter?${params.toString()}`);
    const raw = j(res.data) as { readChapter?: { pages?: { image?: string; number?: number }[] } };
    const pages = raw.readChapter?.pages ?? [];
    return pages
      .map((p, index) => ({ index: p.number ?? index, imageUrl: this.mediaUrl(p.image ?? '') }))
      .filter(p => p.imageUrl.length > 0);
  }

  private idFromUrl(url: string): string {
    const segments = url.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '';
  }

  /**
   * Attend une URL de forme `<mangaId>/read/<chapterId>`, avec ou sans segment initial vide.
   * `lastIndexOf` sur une URL relative (`/manga/x/read/y` -> segments sans '') reste fiable
   * car le pathname relatif est toujours conserve apres filtrage des segments vides.
   */
  private chapterIdsFromUrl(url: string): { mangaId: string; chapterId: string } {
    const segments = url.split('/').filter(Boolean);
    const readIndex = segments.indexOf('read');
    if (readIndex >= 0) {
      return { mangaId: segments[readIndex - 1] ?? '', chapterId: segments[readIndex + 1] ?? '' };
    }
    return { mangaId: this.idFromUrl(url.split('/').slice(0, -2).join('/')), chapterId: '' };
  }
}