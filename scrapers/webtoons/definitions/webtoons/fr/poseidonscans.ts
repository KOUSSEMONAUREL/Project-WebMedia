import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import { extractNextJsRsc, extractNextJsHtml, isJsonObject } from '../../../engine/nextjs';
import type { Json, JsonObject, NextJsPredicate } from '../../../engine/nextjs';

/**
 * Transcompilation de keiyoushi `fr/poseidonscans` (PoseidonScans.kt, baseUrl
 * https://poseidon-scans.net). Site Next.js (App Router) FR.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - La préférence `show_premium_chapters` (def. false) n'existe pas dans le
 *   moteur TS : le comportement est figé à `hidePremium = true` (les chapitres
 *   premium verrouillés sont masqués tant que `premiumUntil` est futur, et les
 *   autres conservent le préfixe 🔒).
 * - `imageRequest` (header Accept d'image) n'est pas porté : le moteur n'a pas
 *   de hook de requête d'image.
 * - `getMangaUrl` = `baseUrl + manga.url` ; les URLs stockées sont relatives
 *   (`/serie/<slug>`), comme dans le Kt.
 * - `createdAt`/`premiumUntil` (ReactFlightDate) : le résolveur `$D` du moteur
 *   NextJS expose l'ISO-8601, transformée en epoch ms.
 */

const MANGAS_PREDICATE: NextJsPredicate = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(item => isJsonObject(item) && typeof item.id === 'string' && typeof item.slug === 'string' && typeof item.title === 'string');

const DETAILS_PREDICATE: NextJsPredicate = value =>
  isJsonObject(value) &&
  typeof value.title === 'string' &&
  typeof value.slug === 'string' &&
  'status' in value &&
  'chapters' in value;

const CHAPTERS_PREDICATE: NextJsPredicate = value =>
  isJsonObject(value) &&
  isJsonObject(value.manga) &&
  Array.isArray(value.manga.chapters) &&
  'isPremiumUser' in value;

const PAGE_PREDICATE: NextJsPredicate = value =>
  isJsonObject(value) &&
  isJsonObject(value.currentChapter) &&
  isJsonObject(value.initialData) &&
  Array.isArray(value.initialData.images);

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function parseStatus(status: string | null | undefined): MangaStatus {
  switch (status?.trim().toLowerCase()) {
    case 'en cours': return 1;
    case 'terminé': return 0;
    case 'en pause':
    case 'hiatus': return 3;
    case 'annulé':
    case 'abandonné': return 2;
    default: return 3;
  }
}

/** Équivalent de `formatTimestamp` du Kt : "dd MMMM HH:mm" (locale FR, fuseau système). */
function formatTimestamp(timestamp: number): [string, string, string] {
  const d = new Date(timestamp);
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS_FR[d.getMonth()] ?? '';
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return [day, month, `${hour}:${minute}`];
}

export class PoseidonscansScraper extends BaseScraper {
  readonly name = 'Poseidon Scans';
  readonly baseUrl = 'https://poseidon-scans.net';
  readonly lang = 'fr';

  private readonly hidePremium = true;

  // ------------------------- Latest -------------------------

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/api/manga/lastchapters?limit=16&page=${page}`, {
      headers: { Accept: 'application/json' },
    });
    const dto = isJsonObject(res.data) ? res.data : null;
    const data = Array.isArray(dto?.data) ? (dto?.data as JsonObject[]).filter(isJsonObject) : [];
    const mangas = data.map(item => {
      const slug = this.strOf(item, 'slug') ?? '';
      return {
        title: this.strOf(item, 'title') ?? '',
        url: `/serie/${slug}`,
        thumbnailUrl: this.toApiCoverUrl(`${slug}.webp`),
        lang: this.lang,
      };
    });
    const hasNextPage = mangas.length === 16;
    return { mangas, hasNextPage };
  }

  // ------------------------- Popular -------------------------

  async getPopular(_page = 1): Promise<SearchResult> {
    const value = await this.fetchRscValue(this.baseUrl, MANGAS_PREDICATE);
    if (!Array.isArray(value)) return { mangas: [], hasNextPage: false };
    const mangas = value.filter(isJsonObject).map(item => {
      const slug = this.strOf(item, 'slug') ?? '';
      return {
        title: this.strOf(item, 'title') ?? '',
        url: `/serie/${slug}`,
        thumbnailUrl: this.toApiCoverUrl(`${slug}.webp`),
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: false };
  }

  // ------------------------- Details -------------------------

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const value = this.extractFrom(res, DETAILS_PREDICATE);
    const dto = isJsonObject(value) ? value : null;
    if (!dto) return { url: mangaUrl, lang: this.lang };
    return this.mangaDtoToDetails(dto);
  }

  private mangaDtoToDetails(dto: JsonObject): Partial<Manga> {
    const slug = this.strOf(dto, 'slug') ?? '';
    const cats = Array.isArray(dto.categories)
      ? dto.categories.filter(isJsonObject)
          .map(c => this.strOf(c, 'name'))
          .filter((n): n is string => n !== undefined && n.trim().length > 0)
          .map(name => name.trim().charAt(0).toLocaleUpperCase('fr') + name.trim().slice(1))
      : [];
    const description = this.strOf(dto, 'description')?.trim();
    return {
      title: this.strOf(dto, 'title') || undefined,
      url: `/serie/${slug}`,
      thumbnailUrl: `${this.baseUrl}/api/covers/${slug}.webp`,
      author: this.strOf(dto, 'author') || undefined,
      artist: this.strOf(dto, 'artist') || undefined,
      description: description && description.length > 0 ? description : undefined,
      status: parseStatus(this.strOf(dto, 'status')),
      genre: cats.length > 0 ? cats.join(', ') : undefined,
      lang: this.lang,
    };
  }

  // ------------------------- Chapters -------------------------

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const abs = this.absUrl(mangaUrl);
    let body = await this.fetchRscBody(abs);
    let chapters = this.chapterListFrom(body);
    if (chapters.length === 0) {
      // RSC peut être partiel au premier chargement ; retry cache-busting
      body = await this.fetchRscBody(`${abs}?_=${Date.now()}`);
      chapters = this.chapterListFrom(body);
    }
    return chapters;
  }

  private chapterListFrom(body: string): Chapter[] {
    const wrapper = extractNextJsRsc(body, CHAPTERS_PREDICATE);
    if (!isJsonObject(wrapper) || !isJsonObject(wrapper.manga)) return [];
    const manga = wrapper.manga;
    const isPremiumUser = wrapper.isPremiumUser === true;
    const slug = this.strOf(manga, 'slug') ?? '';
    const chapters = Array.isArray(manga.chapters) ? manga.chapters.filter(isJsonObject) : [];

    return chapters
      .filter(ch => {
        const isPremium = this.boolOf(ch, 'isPremium') ?? false;
        const isLocked = isPremium && !isPremiumUser;
        if (!this.hidePremium) return true;
        if (!isLocked) return true;
        // Chapitre premium verrouillé : masqué tant que premiumUntil est futur
        const until = this.dateOf(ch, 'premiumUntil') ?? 0;
        return Date.now() > until;
      })
      .map(ch => this.chapterDtoToChapter(ch, slug, isPremiumUser))
      .sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  private chapterDtoToChapter(ch: JsonObject, slug: string, isPremiumUser: boolean): Chapter {
    const number = this.numOf(ch, 'number');
    const numberString = number === undefined ? '' : String(number).replace(/\.0$/, '');
    const rawTitle = this.strOf(ch, 'title');
    const title = rawTitle !== undefined && rawTitle.trim().length > 0 ? rawTitle.trim() : undefined;
    const isPremium = this.boolOf(ch, 'isPremium') ?? false;
    const isLocked = isPremium && !isPremiumUser;
    const isVolume = (this.boolOf(ch, 'isVolume') ?? false) ||
      (number !== undefined && number % 1 === 0 && !!title && title.toLowerCase().includes('volume'));

    const baseName = isVolume ? `Volume ${numberString}` : `Chapitre ${numberString}`;
    let name = '';
    if (isLocked) name += '\u{1F512} ';
    name += title && title.length > 0 ? `${baseName} - ${title}` : baseName;
    if (isLocked) {
      const [day, month, time] = formatTimestamp(this.dateOf(ch, 'premiumUntil') ?? 0);
      name += ` - Free the ${day} ${month} at ${time}`;
    }

    const chapter: Chapter = {
      name: name.trim(),
      url: `/serie/${slug}/chapter/${numberString}`,
      chapterNumber: number,
    };
    const createdAt = this.dateOf(ch, 'createdAt');
    if (createdAt !== undefined) chapter.dateUpload = createdAt;
    return chapter;
  }

  // ------------------------- Pages -------------------------

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const abs = this.absUrl(chapterUrl);
    const res = await this.get(abs, { headers: { rsc: '1' } });
    const value = this.extractFrom(res, PAGE_PREDICATE);
    const dto = isJsonObject(value) ? value : null;
    if (!dto) return [];

    const currentChapter = isJsonObject(dto.currentChapter) ? dto.currentChapter : null;
    const isPremiumChapter = this.boolOf(currentChapter ?? {}, 'isPremium') ?? false;
    if (isPremiumChapter) {
      const sessionStatus = this.strOf(dto, 'sessionStatus');
      if (sessionStatus === 'unauthenticated') {
        throw new Error('This chapter is premium. Please connect via the WebView to view.');
      }
      if (this.boolOf(dto, 'isPremiumUser') !== true) {
        throw new Error('This chapter is premium. You are not a premium user.');
      }
    }

    const initialData = isJsonObject(dto.initialData) ? dto.initialData : null;
    const images = Array.isArray(initialData?.images) ? (initialData?.images as JsonObject[]).filter(isJsonObject) : [];
    return images
      .map(img => {
        const url = this.strOf(img, 'originalUrl') ?? '';
        const order = this.numOf(img, 'order') ?? 0;
        return {
          index: order,
          imageUrl: url ? this.absUrl(url) : '',
        };
      })
      .sort((a, b) => a.index - b.index);
  }

  // ------------------------- Search -------------------------

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/series`);
    if (query.trim().length > 0) url.searchParams.set('search', query.trim());
    if (page > 1) url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    const $ = this.$(String(res.data ?? ''));

    const mangas: Manga[] = [];
    $('div.grid a.block.group').each((_i, el) => {
      const $a = $(el);
      const href = $a.attr('href') ?? '';
      const title = $a.find('h2').first().text();
      const srcset = $a.find('img[alt]').first().attr('srcset') ?? '';
      const firstCandidate = srcset.split(' ')[0] ?? '';
      let thumbPath = '';
      try {
        thumbPath = decodeURIComponent(firstCandidate)
          .split('url=')[1]?.split('&')[0] ?? '';
      } catch {
        thumbPath = '';
      }
      const manga: Manga = {
        title,
        url: this.relativize(this.absUrl(href)),
        thumbnailUrl: thumbPath.trim().length > 0
          ? this.toApiCoverUrl(thumbPath.trim())
          : '',
        lang: this.lang,
      };
      mangas.push(manga);
    });

    const hasNextPage = $('nav[aria-label="Pagination"] a')
      .filter((_i, el) => $(el).text().includes('Suivant')).length > 0;
    return { mangas, hasNextPage };
  }

  // ------------------------- RSC fetchers -------------------------

  private extractFrom(res: { data: unknown; headers?: Record<string, unknown> }, predicate: NextJsPredicate): Json | null {
    const contentType = String(res.headers?.['content-type'] ?? '');
    return contentType.includes('text/html')
      ? extractNextJsHtml(String(res.data ?? ''), predicate)
      : extractNextJsRsc(String(res.data ?? ''), predicate);
  }

  private async fetchRscValue(url: string, predicate: NextJsPredicate): Promise<Json | null> {
    const res = await this.get(url, { headers: { rsc: '1' } });
    const contentType = String(res.headers?.['content-type'] ?? '');
    return contentType.includes('text/html')
      ? extractNextJsHtml(String(res.data ?? ''), predicate)
      : extractNextJsRsc(String(res.data ?? ''), predicate);
  }

  private async fetchRscBody(url: string): Promise<string> {
    const res = await this.get(url, { headers: { rsc: '1' } });
    return String(res.data ?? '');
  }

  // ------------------------- Utilities -------------------------

  private toApiCoverUrl(path: string): string {
    if (path.startsWith('http')) return path;
    if (path.includes('storage/covers/')) {
      return `${this.baseUrl}/api/covers/${path.split('storage/covers/')[1] ?? ''}`;
    }
    if (path.startsWith('/api/covers/')) return this.baseUrl + path;
    if (path.startsWith('/')) return this.baseUrl + path;
    return `${this.baseUrl}/api/covers/${path}`;
  }

  private relativize(pathOrUrl: string): string {
    return pathOrUrl.startsWith(this.baseUrl) ? pathOrUrl.slice(this.baseUrl.length) : pathOrUrl;
  }

  private strOf(obj: JsonObject, key: string): string | undefined {
    const v = obj[key];
    return typeof v === 'string' ? v : undefined;
  }

  private numOf(obj: JsonObject, key: string): number | undefined {
    const v = obj[key];
    return typeof v === 'number' ? v : undefined;
  }

  private boolOf(obj: JsonObject, key: string): boolean | undefined {
    const v = obj[key];
    return typeof v === 'boolean' ? v : undefined;
  }

  /** createdAt / premiumUntil : ISO (résolu depuis `$D`) → epoch ms */
  private dateOf(obj: JsonObject, key: string): number | undefined {
    const v = obj[key];
    if (typeof v !== 'string' || v.length === 0) return undefined;
    const iso = v.startsWith('$D') ? v.substring(2) : v;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? undefined : ms;
  }
}