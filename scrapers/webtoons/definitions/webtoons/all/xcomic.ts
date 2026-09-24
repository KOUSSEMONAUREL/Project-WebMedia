import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const BROWSE_PAGE_SIZE = 12;
const TITLES_IN_FLIGHT = 3;
const COMIC_PROBES_PER_TITLE = 5;

const READ_DIRECTION_LABELS: [string, string][] = [
  ['ttb', '⬇️ Top To Bottom'],
  ['rtl', '⬅️ Right To Left'],
  ['ltr', '➡️ Left To Right'],
];

const TITLE_BROWSE_QUERY = `
    query get_title_browse($select: Title_Browse_Select) {
        get_title_browse_items(select: $select) {
            id
            data {
                title
                native_title
                romanized_title
                original_language
                translated_languages
                type
                cover_local_url
                cover_url
                comic_ids
                chap_last_public_at
            }
        }
    }
`;

const TITLE_NODE_QUERY = `
    query get_title_titleNode($id: ID!) {
        get_title_titleNode(id: $id) {
            id
            data {
                title
                alt_titles
                native_title
                romanized_title
                original_language
                translated_languages
                authors
                artists
                year
                type
                status
                description
                cover_local_url
                cover_local
                cover_url
                urlPath
                total_comics
                total_chapters
                total_follows
                total_reviews
                total_comments
                vote_avg
                vote_users
                vote_bay
                vote_val
                chap_last_public_at
                created_at
                updated_at
                is_merged
                merged_to
                comic_ids
                content_rating_id
                type_id
                demographic_ids
                genre_ids
                format_ids
                tracking_sites {
                    anilist
                    myanimelist
                    mangaupdates
                    kitsu
                    animeplanet
                    shikimori
                    mangabaka
                }
            }
        }
    }
`;

const COMIC_NODE_QUERY = `
    query get_comicNode($id: ID!) {
        get_comicNode(id: $id) {
            id
            data {
                id
                name
                subName
                altNames
                authors
                artists
                originalLanguage
                translatedLanguage
                originalStatus
                uploadStatus
                type
                demographics
                contentRating
                genres
                tags
                publishers
                dbStatus
                isPublic
                follows
                reviews
                comments_total
                score_val
                is_hot
                is_new
                originalPubFrom { y m d }
                originalPubTill { y m d }
                originalPubZone
                chaps_normal
                dateUpload
                chapterNode_up_to {
                    id
                    data {
                        dname
                        datePublic
                    }
                }
                summary { text }
                extraInfo { text }
                readDirection
                urlPath
                urlCover
            }
        }
    }
`;

const COMIC_PROBE_QUERY = `
    query get_comicNode($id: ID!) {
        get_comicNode(id: $id) {
            id
            data {
                name
                subName
                dbStatus
                isPublic
                translatedLanguage
                chaps_normal
                urlPath
                urlCover
            }
        }
    }
`;

const CHAPTER_LIST_QUERY = `
    query get_comic_chapterList_fullList($select: Select_Comic_ChapterList) {
        get_comic_chapterList_fullList(select: $select) {
            paging { next total }
            items {
                id
                data {
                    id
                    dname
                    title
                    urlPath
                    dateCreate
                    datePublic
                    dateModify
                    chaNum
                    volNum
                    count_images
                    is_new
                    srcName
                    profileNodes { data { name } }
                }
            }
        }
    }
`;

const CHAPTER_PAGES_QUERY = `
    query($id: ID!) {
        get_chapterNode(id: $id) {
            id
            data { imageUrls }
        }
    }
`;

const ID_QUERY_REGEX = /^id\s*:?\s*([a-zA-Z0-9-_]+)\s*$/i;

const LANGUAGES: [string, string][] = [
  ['English', 'en'], ['French', 'fr'], ['Portuguese', 'pt'], ['Korean', 'ko'],
  ['Japanese', 'ja'], ['Indonesian', 'id'], ['Chinese', 'zh'], ['Chinese (Traditional)', 'zh_hk'], ['Abkhazian', 'ab'],
  ['Afrikaans', 'af'], ['Armenian', 'hy'], ['Arabic', 'ar'], ['Albanian', 'sq'],
  ['Azerbaijani', 'az'], ['Belarusian', 'be'], ['Bengali', 'bn'], ['Burmese', 'my'],
  ['Bulgarian', 'bg'], ['Bosnian', 'bs'], ['Cambodian', 'km'], ['Catalan', 'ca'],
  ['Cebuano', 'ceb'], ['Czech', 'cs'], ['Croatian', 'hr'], ['Chuvash', 'cv'],
  ['Danish', 'da'], ['Dutch', 'nl'], ['Estonian', 'et'], ['Esperanto', 'eo'],
  ['Basque', 'eu'], ['Filipino', 'fil'], ['Finnish', 'fi'], ['German', 'de'],
  ['Georgian', 'ka'], ['Greek', 'el'], ['Guarani', 'gn'], ['Gujarati', 'gu'],
  ['Hindi', 'hi'], ['Hebrew', 'he'], ['Haitian Creole', 'ht'], ['Hungarian', 'hu'],
  ['Icelandic', 'is'], ['Igbo', 'ig'], ['Galician', 'gl'], ['Irish', 'ga'],
  ['Italian', 'it'], ['Kazakh', 'kk'], ['Kyrgyz', 'ky'], ['Lithuanian', 'lt'],
  ['Latin', 'la'], ['Laothian', 'lo'], ['Kurdish', 'ku'], ['Javanese', 'jv'],
  ['Malagasy', 'mg'], ['Latvian', 'lv'], ['Malay', 'ms'], ['Malayalam', 'ml'],
  ['Maltese', 'mt'], ['Moldavian', 'mo'], ['Marathi', 'mr'], ['Maori', 'mi'],
  ['Mongolian', 'mn'], ['Nyanja', 'ny'], ['Nepali', 'ne'], ['Pashto', 'ps'],
  ['Norwegian', 'no'], ['Persian', 'fa'], ['Portuguese (BR)', 'pt_br'], ['Serbian', 'sr'],
  ['Sesotho', 'st'], ['Russian', 'ru'], ['Romanian', 'ro'], ['Polish', 'pl'],
  ['Serbo-Croatian', 'sh'], ['Sinhalese', 'si'], ['Somali', 'so'], ['Swedish', 'sv'],
  ['Thai', 'th'], ['Turkish', 'tr'], ['Swati', 'ss'], ['Slovak', 'sk'],
  ['Spanish', 'es'], ['Tigrinya', 'ti'], ['Tamil', 'ta'], ['Turkmen', 'tk'],
  ['Ukrainian', 'uk'], ['Tonga', 'to'], ['Telugu', 'te'], ['Spanish (LA)', 'es_419'],
  ['Slovenian', 'sl'], ['Vietnamese', 'vi'], ['Urdu', 'ur'], ['Yoruba', 'yo'], ['Other', '_t'], ['Uzbek', 'uz'],
  ['Zulu', 'zu'],
];

interface TitleBrowseItem {
  title?: string | null;
  native_title?: string | null;
  romanized_title?: string | null;
  original_language?: string | null;
  translated_languages?: (string | null)[] | null;
  type?: string | null;
  chap_last_public_at?: number | null;
  cover_local_url?: string | null;
  cover_url?: string | null;
  comic_ids?: string[] | null;
}

interface TitleBrowseNode {
  id?: string | null;
  data?: TitleBrowseItem | null;
}

interface TitleBrowseData {
  get_title_browse_items?: TitleBrowseNode[] | null;
}

interface ComicProbeData {
  name?: string | null;
  subName?: string | null;
  dbStatus?: string | null;
  isPublic?: boolean | null;
  translatedLanguage?: string | null;
  chaps_normal?: number | null;
  urlPath?: string | null;
  urlCover?: string | null;
}

interface TitleTrackingSites {
  anilist?: number | null;
  myanimelist?: number | null;
  mangaupdates?: string | null;
  kitsu?: number | null;
  animeplanet?: string | null;
  shikimori?: string | null;
  mangabaka?: number | null;
}

interface TitleNodeData {
  id?: string | null;
  title?: string | null;
  alt_titles?: (string | null)[] | null;
  native_title?: string | null;
  romanized_title?: string | null;
  original_language?: string | null;
  translated_languages?: (string | null)[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  content_rating_id?: string | null;
  type_id?: string | null;
  demographic_ids?: string[] | null;
  genre_ids?: string[] | null;
  format_ids?: string[] | null;
  year?: number | null;
  type?: string | null;
  status?: string | null;
  description?: string | null;
  cover_local_url?: string | null;
  cover_local?: string | null;
  cover_url?: string | null;
  urlPath?: string | null;
  total_comics?: number | null;
  total_chapters?: number | null;
  total_follows?: number | null;
  total_reviews?: number | null;
  total_comments?: number | null;
  vote_avg?: number | null;
  vote_users?: number | null;
  vote_bay?: number | null;
  vote_val?: number | null;
  chap_last_public_at?: number | null;
  created_at?: number | null;
  updated_at?: number | null;
  is_merged?: boolean | null;
  merged_to?: string | null;
  comic_ids?: string[] | null;
  tracking_sites?: TitleTrackingSites | null;
}

interface ComicNode {
  id: string;
  name: string;
  subName?: string | null;
  altNames?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
  originalStatus?: string | null;
  uploadStatus?: string | null;
  type?: string | null;
  demographics?: string[] | null;
  contentRating?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
  publishers?: string[] | null;
  dbStatus?: string | null;
  isPublic?: boolean | null;
  is_hot?: boolean | null;
  is_new?: boolean | null;
  follows?: number | null;
  reviews?: number | null;
  comments_total?: number | null;
  score_val?: number | null;
  chaps_normal?: number | null;
  dateUpload?: number | null;
  chapterNode_up_to?: { data?: { dname?: string | null; datePublic?: number | null } | null } | null;
  summary?: { text?: string | null } | null;
  extraInfo?: { text?: string | null } | null;
  readDirection?: string | null;
  urlPath?: string | null;
  urlCover?: string | null;
  trackingSites?: {
    mangaupdates?: string | null;
    myanimelist?: string | null;
    animeplanet?: string | null;
    anilist?: string | null;
    kitsu?: string | null;
  } | null;
}

interface ChapterData {
  id: string;
  dname: string;
  title?: string | null;
  urlPath?: string | null;
  dateCreate?: number | null;
  datePublic?: number | null;
  dateModify?: number | null;
  chaNum?: number | null;
  volNum?: number | null;
  count_images?: number | null;
  is_new?: boolean | null;
  srcName?: string | null;
  profileNodes?: { data: { name: string } | null }[] | null;
}

interface ChapterItem {
  id: string;
  data: ChapterData;
}

function toTitleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.toLowerCase().replace(/^./, (c) => c.toUpperCase()))
    .join(' ');
}

function toTagCase(value: string): string {
  return toTitleCase(value);
}

function languageLabel(code: string): string {
  const entry = LANGUAGES.find(([, c]) => c === code);
  return entry ? entry[0] : code;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class XCOMICScraper extends BaseScraper {
  readonly name = 'XCOMIC';
  readonly baseUrl = 'https://xcomic.me';
  readonly lang = 'all';

  private probeCache = new Map<string, ComicProbeData>();
  private titleFreshness = new Map<string, number>();

  async getPopular(page = 1): Promise<SearchResult> {
    return this.search('', page, 'field_score');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.search('', page, 'field_update');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const idMatch = ID_QUERY_REGEX.exec(query.trim());
    if (idMatch) {
      const id = idMatch[1].split('-')[0];
      const extLang = this.lang === 'all' ? null : this.mapLangCode(this.lang);
      const node = await this.fetchTitleNode(id);
      if (node) {
        const cover = node.cover_local_url ?? node.cover_url ?? '';
        const firstComic = node.comic_ids?.[0];
        const manga: Manga = {
          title: this.cleanTitle(node.title ?? id),
          url: firstComic ? `${node.id}:${firstComic}` : (node.id ?? id),
          thumbnailUrl: cover ? this.absUrl(cover) : '',
          lang: this.lang,
        };
        return { mangas: [manga], hasNextPage: false };
      }
      try {
        const comic = await this.fetchComicNodeLegacy(id);
        if (comic) return { mangas: [this.comicToManga(comic)], hasNextPage: false };
      } catch { /* ignore */ }
      return { mangas: [], hasNextPage: false };
    }
    return this.search(query, page, null);
  }

  private async search(word: string, page: number, sortby: string | null): Promise<SearchResult> {
    const extLang = this.lang === 'all' ? [] : [this.mapLangCode(this.lang)];
    const variables = {
      select: {
        page,
        size: BROWSE_PAGE_SIZE,
        init: (page - 1) * BROWSE_PAGE_SIZE,
        sortby,
        word,
        where: 'browse',
        incTLangs: extLang,
        incTypes: [] as string[],
        incDemographics: [] as string[],
        incContentRatings: [] as string[],
        incGenres: [] as string[],
        excGenres: [] as string[],
        incGenresMode: null,
        excGenresMode: null,
        incOLangs: [] as string[],
        origStatus: [] as string[],
        chapCount: null,
        ignoreGlobalGenres: false,
      },
    };
    const data = await this.graphql<{ get_title_browse_items: TitleBrowseNode[] }>(TITLE_BROWSE_QUERY, variables);
    const titles: TitleBrowseNode[] = (data?.get_title_browse_items ?? []) as TitleBrowseNode[];
    if (titles.length === 0) return { mangas: [], hasNextPage: false };
    // Fast path: return one manga per title without per-source probing to stay within 10s batch timeout.
    // Detailed per-source flattening is done lazily in getMangaDetails / chapter resolution.
    const mangas: Manga[] = titles.map((t) => {
      const title = this.cleanTitle(t.data?.title ?? t.id ?? '');
      const firstComic = t.data?.comic_ids?.[0] ?? t.id ?? '';
      const tid = t.id ?? '';
      const cover = t.data?.cover_local_url ?? t.data?.cover_url ?? '';
      return {
        title: title || tid,
        url: firstComic ? `${tid}:${firstComic}` : tid,
        thumbnailUrl: cover ? this.absUrl(cover) : '',
        lang: this.lang,
      };
    });
    return { mangas, hasNextPage: titles.length >= BROWSE_PAGE_SIZE };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const [manga, ] = await this.getMangaDetailsWithGate(mangaUrl);
    return manga;
  }

  private async getMangaDetailsWithGate(mangaUrl: string): Promise<[Manga, boolean]> {
    const extLang = this.lang === 'all' ? null : this.mapLangCode(this.lang);
    const [titleId, pinned] = this.splitMangaUrl(mangaUrl);
    let title = await this.fetchTitleNode(titleId);
    if (!title) {
      const comic = await this.fetchComicNodeLegacy(mangaUrl);
      if (comic) {
        const m = this.comicToManga(comic);
        m.url = mangaUrl;
        return [m, false];
      }
      throw new Error('XCOMIC: title not found');
    }
    if (title.is_merged && title.merged_to && title.merged_to !== titleId) {
      const merged = await this.fetchTitleNode(title.merged_to);
      if (merged) title = merged;
    }
    let comicId: string | null = null;
    let comic: ComicNode | null = null;
    if (pinned) {
      const c = await this.fetchComicNode(pinned);
      if (c && this.isLive(c as unknown as ComicProbeData)) { comicId = pinned; comic = c; }
    }
    if (!comic) {
      const ids = (title.comic_ids ?? []).filter((id): id is string => !!id);
      const picked = await this.pickComic(ids, extLang);
      if (!picked) throw new Error(`Failed to load '${this.lang}' uploads for this source`);
      [comicId, comic] = picked;
    }
    if (!comic || !comicId) throw new Error('XCOMIC: comic not found');
    const base = this.comicToManga(comic);
    base.url = mangaUrl;
    this.overlayTitleOnto(base, title);
    const label = comic.subName ?? null;
    if (label) base.title = `${base.title} \u00b7 ${this.unescapeHtml(label)}`;
    return [base, false];
  }

  private async pickComic(ids: string[], extLang: string | null): Promise<[string, ComicNode] | null> {
    if (ids.length === 0) return null;
    const results = await Promise.all(ids.map(async (cid) => {
      const n = await this.fetchComicNode(cid);
      return n ? ([cid, n] as [string, ComicNode]) : null;
    }));
    const nodes: [string, ComicNode][] = [];
    for (const r of results) if (r && this.isLive(r[1] as unknown as ComicProbeData)) nodes.push(r);
    const filtered = nodes.filter(([, n]) => extLang == null || n.translatedLanguage === extLang);
    const best = filtered.length > 0 ? filtered.sort((a, b) => (b[1].chaps_normal ?? 0) - (a[1].chaps_normal ?? 0))[0] : null;
    if (best) return best;
    if (extLang == null && nodes.length > 0) return nodes[0];
    return null;
  }

  private async flattenTitle(t: TitleBrowseNode, extLang: string | null, forceFresh = false): Promise<[string, string, ComicProbeData][]> {
    const titleId = t.id ?? '';
    if (!titleId) return [];
    const ids = (t.data?.comic_ids ?? []).filter((id): id is string => !!id && id.trim().length > 0);
    if (ids.length === 0) return [];
    const nowPublic = t.data?.chap_last_public_at ?? 0;
    const unchanged = !forceFresh && nowPublic !== null && nowPublic !== 0 && nowPublic <= (this.titleFreshness.get(titleId) ?? 0);
    if (unchanged && ids.every((id) => this.probeCache.has(id))) {
      return ids.map((cid) => this.probeCache.get(cid)!).filter((p) => this.isLive(p) && (extLang == null || p.translatedLanguage === extLang)).map((p) => {
        const cid = ids.find((id) => this.probeCache.get(id) === p) ?? ids[0];
        return [titleId, cid, p] as [string, string, ComicProbeData];
      }).sort((a, b) => (b[2].chaps_normal ?? 0) - (a[2].chaps_normal ?? 0));
    }
    const probes = new Map<string, ComicProbeData>();
    const probeResults = await Promise.all(ids.map(async (cid) => {
      const p = await this.fetchComicProbe(cid);
      return p ? ([cid, p] as const) : null;
    }));
    for (const r of probeResults) if (r) probes.set(r[0], r[1]);
    if (nowPublic && nowPublic > 0) this.titleFreshness.set(titleId, nowPublic);
    const out: [string, string, ComicProbeData][] = [];
    for (const [cid, p] of probes.entries()) {
      if (this.isLive(p) && (extLang == null || p.translatedLanguage === extLang)) out.push([titleId, cid, p]);
    }
    out.sort((a, b) => (b[2].chaps_normal ?? 0) - (a[2].chaps_normal ?? 0));
    return out;
  }

  private isLive(p: ComicProbeData | ComicNode): boolean {
    const isPublic = (p as ComicProbeData).isPublic ?? (p as ComicNode).isPublic;
    const dbStatus = (p as ComicProbeData).dbStatus ?? (p as ComicNode).dbStatus;
    return isPublic !== false && (dbStatus == null || dbStatus === 'normal');
  }

  private probeToManga(p: ComicProbeData, titleId: string, comicId: string, t: TitleBrowseNode, extLang: string | null): Manga {
    const displayTitle = this.cleanTitle(t.data?.title ?? titleId);
    let title = displayTitle;
    if (p.subName) title += ` \u00b7 ${this.unescapeHtml(p.subName)}`;
    if (extLang == null && p.translatedLanguage) title += ` [${languageLabel(p.translatedLanguage)}]`;
    const thumb = p.urlCover ?? t.data?.cover_local_url ?? t.data?.cover_url ?? '';
    return {
      title,
      url: `${titleId}:${comicId}`,
      thumbnailUrl: thumb ? this.absUrl(thumb) : '',
      lang: this.lang,
    };
  }

  private comicToManga(node: ComicNode): Manga {
    const author = node.authors?.join(', ') || undefined;
    const genreSet = new Set<string>();
    if (node.type) genreSet.add(toTitleCase(node.type));
    node.demographics?.forEach((d) => genreSet.add(toTitleCase(d)));
    if (node.contentRating) genreSet.add(toTitleCase(node.contentRating));
    node.genres?.forEach((g) => genreSet.add(toTitleCase(g)));
    const status = this.mapStatus(node.originalStatus ?? node.uploadStatus, node.uploadStatus);
    const thumbnailUrl = node.urlCover ? this.absUrl(node.urlCover) : node.urlCover ? this.absUrl(node.urlCover) : '';
    const desc = this.buildDescription(node);
    return {
      title: this.cleanTitle(node.name),
      url: node.id,
      thumbnailUrl,
      lang: this.lang,
      author,
      genre: [...genreSet].join(', ') || undefined,
      status,
      description: desc || undefined,
    };
  }

  private overlayTitleOnto(m: Manga, title: TitleNodeData): void {
    if (title.title && this.cleanTitle(title.title)) m.title = this.cleanTitle(title.title);
    if (title.cover_local_url ?? title.cover_url) {
      const c = title.cover_local_url ?? title.cover_url ?? '';
      if (c) m.thumbnailUrl = c.startsWith('http') ? c : this.absUrl(c);
    }
    const genreSet = new Set<string>();
    if (m.genre) m.genre.split(', ').forEach((g) => { if (g) genreSet.add(g); });
    if (title.type) genreSet.add(toTagCase(title.type));
    title.demographic_ids?.forEach((d) => genreSet.add(toTagCase(d)));
    if (title.content_rating_id) genreSet.add(toTagCase(title.content_rating_id));
    title.genre_ids?.forEach((g) => genreSet.add(toTagCase(g)));
    title.format_ids?.forEach((g) => genreSet.add(toTagCase(g)));
    if (genreSet.size > 0) m.genre = [...genreSet].join(', ');
    const parts: string[] = [];
    if (title.original_language) parts.push(`**Original**: ${languageLabel(title.original_language)}`);
    if (title.translated_languages && title.translated_languages.filter(Boolean).length > 0) {
      const langs = (title.translated_languages as string[]).filter(Boolean).map((c) => languageLabel(c)).join(', ');
      parts.push(`**Translated**: ${langs}`);
    }
    if (title.year) parts.push(`**Released**: ${title.year}`);
    if (title.type) parts.push(`**Type**: ${toTagCase(title.type)}`);
    if (title.description) parts.push(title.description);
    if (title.chap_last_public_at) parts.push(`**Updated**: ${new Date(title.chap_last_public_at).toISOString().slice(0, 10)}`);
    const stats: string[] = [];
    if (title.vote_avg && title.vote_avg > 0) stats.push(`**Score**: ${title.vote_avg.toFixed(1)}`);
    if (title.vote_users && title.vote_users > 0) stats.push(`**Votes**: ${title.vote_users}`);
    if (title.total_follows && title.total_follows > 0) stats.push(`**Follows**: ${title.total_follows}`);
    if (stats.length > 0) parts.push(`**Statistics**\n${stats.join(' \u00b7 ')}`);
    if (title.alt_titles && title.alt_titles.filter(Boolean).length > 0) {
      const alt = (title.alt_titles as string[]).filter((a) => a && a !== title.title);
      if (alt.length > 0) parts.push(`**Alternative Titles**:\n${alt.map((a) => `- ${a}`).join('\n')}`);
    }
    let extra = parts.join('\n\n');
    if (extra) extra += '\n\n---\n\n';
    const existing = m.description ?? '';
    const links: string[] = [];
    const ts = title.tracking_sites;
    if (ts?.anilist) links.push(`[AniList](https://anilist.co/manga/${ts.anilist})`);
    if (ts?.myanimelist) links.push(`[MyAnimeList](https://myanimelist.net/manga/${ts.myanimelist})`);
    if (ts?.mangaupdates) links.push(`[MangaUpdates](https://www.mangaupdates.com/series/${ts.mangaupdates})`);
    if (ts?.kitsu) links.push(`[Kitsu](https://kitsu.app/manga/${ts.kitsu})`);
    if (ts?.animeplanet) links.push(`[Anime-Planet](https://www.anime-planet.com/manga/${ts.animeplanet})`);
    let suffix = '';
    if (links.length > 0) suffix = `\n\n**External Links**:\n${links.map((l) => `- ${l}`).join('\n')}`;
    m.description = (extra + existing + suffix).trim() || undefined;
  }

  private mapStatus(originalStatus: string | null | undefined, uploadStatus: string | null | undefined): 0 | 1 | 2 | 3 {
    const status = originalStatus ?? uploadStatus;
    if (!status) return 0;
    if (status.includes('pending')) return 0;
    if (status.includes('ongoing')) return 1;
    if (status.includes('cancelled')) return 3;
    if (status.includes('hiatus')) return 0;
    if (status.includes('completed')) return 2;
    return 0;
  }

  private buildDescription(node: ComicNode): string {
    let desc = '';
    if (node.is_hot) desc += '🔥 HOT ';
    if (node.is_new) desc += '✨ NEW';
    if (node.is_hot || node.is_new) desc += '\n\n';
    const metadata: string[] = [];
    if (node.originalLanguage) metadata.push(`**Original**: ${languageLabel(node.originalLanguage)}`);
    if (node.translatedLanguage) metadata.push(`**Translated**: ${languageLabel(node.translatedLanguage)}`);
    if (node.readDirection) {
      const label = READ_DIRECTION_LABELS.find(([code]) => code === node.readDirection)?.[1] ?? node.readDirection;
      metadata.push(`**Read Direction**: ${label}`);
    }
    if (metadata.length > 0) { desc += metadata.join('\n') + '\n\n'; }
    const stats: string[] = [];
    if (node.score_val && node.score_val > 0) stats.push(`**Score**: ${node.score_val.toFixed(1)}`);
    if (node.follows && node.follows > 0) stats.push(`**Follows**: ${node.follows}`);
    if (node.reviews && node.reviews > 0) stats.push(`**Reviews**: ${node.reviews}`);
    if (node.comments_total && node.comments_total > 0) stats.push(`**Comments**: ${node.comments_total}`);
    if (node.chaps_normal && node.chaps_normal > 0) stats.push(`**Chapters**: ${node.chaps_normal}`);
    if (stats.length > 0) { desc += `**Statistics**\n${stats.join(' \u00b7 ')}\n\n`; }
    if (node.summary?.text) desc += this.toMarkdownUrls(node.summary.text);
    const links: string[] = [];
    if (node.trackingSites?.mangaupdates) links.push(`[MangaUpdates](https://www.mangaupdates.com/series/${node.trackingSites.mangaupdates})`);
    if (node.trackingSites?.myanimelist) links.push(`[MyAnimeList](https://myanimelist.net/manga/${node.trackingSites.myanimelist})`);
    if (node.trackingSites?.animeplanet) links.push(`[Anime-Planet](https://www.anime-planet.com/manga/${node.trackingSites.animeplanet})`);
    if (node.trackingSites?.anilist) links.push(`[AniList](https://anilist.co/manga/${node.trackingSites.anilist})`);
    if (node.trackingSites?.kitsu) links.push(`[Kitsu](https://kitsu.app/manga/${node.trackingSites.kitsu})`);
    if (links.length > 0) { if (desc.length > 0) desc += '\n\n'; desc += '**External Links**:\n' + links.map((l) => `- ${l}`).join('\n'); }
    return desc.trim();
  }

  private toMarkdownUrls(text: string): string {
    return text.replace(/(?<!\[|\()https?:\/\/[^\s<"]+/g, (m) => `[${m}](${m})`);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const comicId = await this.resolveComicId(mangaUrl);
    if (!comicId) return [];
    const firstPage = await this.fetchChapterListPage(comicId, 1);
    const allChapters = [...firstPage.chapters];
    const totalItems = firstPage.total ?? 0;
    if (totalItems > 1000 && firstPage.hasNextPage) {
      const totalPages = Math.ceil(totalItems / 1000);
      for (let start = 2; start <= totalPages; start += 3) {
        const batch: Promise<{ chapters: Chapter[] }>[] = [];
        for (let p = start; p < start + 3 && p <= totalPages; p++) batch.push(this.fetchChapterListPage(comicId, p));
        const pages = await Promise.all(batch);
        for (const page of pages) allChapters.push(...page.chapters);
      }
    }
    return allChapters;
  }

  private async resolveComicId(mangaUrl: string): Promise<string | null> {
    const [titleId, pinned] = this.splitMangaUrl(mangaUrl);
    if (pinned) return pinned;
    const title = await this.fetchTitleNode(titleId);
    if (!title) return mangaUrl; // legacy comic id
    const ids = (title.comic_ids ?? []).filter((id): id is string => !!id);
    const extLang = this.lang === 'all' ? null : this.mapLangCode(this.lang);
    const picked = await this.pickComic(ids, extLang);
    return picked ? picked[0] : null;
  }

  private async fetchChapterListPage(comicId: string, page: number): Promise<{ chapters: Chapter[]; total: number | null; hasNextPage: boolean }> {
    const variables = { select: { comic_id: comicId, page, size: 1000, sortby: 'chapter_desc' } };
    const data = await this.graphql<{ get_comic_chapterList_fullList: { paging: { next: number | null; total: number | null } | null; items: ChapterItem[] | null } | null }>(CHAPTER_LIST_QUERY, variables);
    const response = data?.get_comic_chapterList_fullList;
    if (!response) throw new Error('XCOMIC: chapter list not found');
    const items: ChapterItem[] = response.items ?? [];
    const chapters = items.map((item) => this.chapterToChapter(item));
    return { chapters, total: response.paging?.total ?? null, hasNextPage: (response.paging?.next ?? 0) !== 0 };
  }

  private chapterToChapter(item: ChapterItem): Chapter {
    const d = item.data;
    const displayName = d.dname ?? '';
    const nameParts: string[] = [];
    const number = (d.chaNum ?? d.volNum)?.toString().replace(/\.0$/, '');
    if (number != null && !displayName.includes(number)) nameParts.push(`Chapter ${number}`);
    if (displayName) nameParts.push(displayName);
    if (d.title) nameParts.push(d.title);
    const name = nameParts.join(': ');
    let scanlator: string | undefined;
    if (d.srcName && d.srcName.length > 0) scanlator = d.srcName.replace(/^./, (c) => c.toUpperCase());
    else {
      const profiles = d.profileNodes?.map((n) => n.data?.name).filter((n): n is string => !!n);
      if (profiles && profiles.length > 0) scanlator = profiles.join(', ');
    }
    return { name, url: item.id, chapterNumber: d.chaNum ?? undefined, dateUpload: d.dateModify ?? d.dateCreate ?? d.datePublic ?? undefined, scanlator };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.split('#')[0];
    const data = await this.graphql<{ get_chapterNode: { data: { imageUrls: string[] | null } | null } | null }>(CHAPTER_PAGES_QUERY, { id });
    const imageUrls = data?.get_chapterNode?.data?.imageUrls ?? [];
    return imageUrls.map((url, index) => ({ index, imageUrl: url.startsWith('http') ? url : this.absUrl(url) }));
  }

  private async fetchTitleNode(id: string): Promise<TitleNodeData | null> {
    try {
      const payload = await this.graphql<{ get_title_titleNode: { id: string | null; data: TitleNodeData | null } | null }>(TITLE_NODE_QUERY, { id });
      const outer = payload?.get_title_titleNode;
      if (!outer?.data) return null;
      return { id: outer.id ?? outer.data.id ?? id, ...outer.data };
    } catch { return null; }
  }

  private async fetchComicNode(id: string): Promise<ComicNode | null> {
    try {
      const payload = await this.graphql<{ get_comicNode: { data: ComicNode } }>(COMIC_NODE_QUERY, { id });
      return payload?.get_comicNode?.data ?? null;
    } catch { return null; }
  }

  private async fetchComicNodeLegacy(id: string): Promise<ComicNode | null> {
    return this.fetchComicNode(id);
  }

  private async fetchComicProbe(id: string): Promise<ComicProbeData | null> {
    if (this.probeCache.has(id)) return this.probeCache.get(id)!;
    try {
      const payload = await this.graphql<{ get_comicNode: { data: ComicProbeData } }>(COMIC_PROBE_QUERY, { id });
      const data = payload?.get_comicNode?.data ?? null;
      if (data) this.probeCache.set(id, data);
      return data;
    } catch { return null; }
  }

  private splitMangaUrl(url: string): [string, string | null] {
    const i = url.indexOf(':');
    return i < 0 ? [url, null] : [url.substring(0, i), url.substring(i + 1)];
  }

  private cleanTitle(title: string): string {
    return title.replace(/\([^()]*\)|\{[^{}]*\}|\[(?:(?!]).)*]|«[^»]*»|〘[^〙]*〙|「[^」]*」|『[^』]*』|≪[^≫]*≫|﹛[^﹜]*﹜|〖[^〖〗]*〗|\uD81A\uDD0D.+?\uD81A\uDD0D|《[^》]*》|⌜.+?⌝|⟨[^⟩]*⟩|\/Official|\/ Official/gi, '').trim();
  }

  private unescapeHtml(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
  }

  private mapLangCode(code: string): string {
    switch (code) {
      case 'pt-BR': return 'pt_br';
      case 'es-419': return 'es_419';
      case 'zh-Hant': return 'zh_hk';
      case 'other': return '_t';
      default: return code;
    }
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.post('/query/', { query, variables }, {
      headers: { 'Content-Type': 'application/json', Origin: this.baseUrl, Referer: `${this.baseUrl}/` },
    });
    const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const errors: { message?: string }[] | null = json?.errors ?? null;
    if (errors && errors.length > 0) throw new Error(errors.map((e) => e.message ?? 'GraphQL error').join('\n'));
    return (json?.data ?? {}) as T;
  }
}
