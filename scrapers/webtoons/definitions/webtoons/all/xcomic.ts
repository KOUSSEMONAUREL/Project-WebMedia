import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const BROWSE_PAGE_SIZE = 12;
const COMIC_PROBES_PER_TITLE = 5;
const CHAPTER_PAGE_SIZE = 100;

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

const TITLE_BROWSE_PAGER_QUERY = `
    query get_title_browse_pager($select: Title_Browse_Select) {
        get_title_browse_pager(select: $select) {
            next
            total
        }
    }
`;

const TITLE_NODE_QUERY = `
    query get_title_titleNode($id: ID!) {
        get_title_titleNode(id: $id) {
            id
            data {
                id
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
                originalLanguage
                translatedLanguage
                originalStatus
                uploadStatus
                type
                demographics
                contentRating
                genres
                tags
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
                trackingSites {
                    anilist
                    myanimelist
                    mangaupdates
                    kitsu
                    animeplanet
                }
                urlPath
                urlCover
                title_titleNode {
                    id
                    data {
                        id
                        title
                        alt_titles
                        native_title
                        romanized_title
                        original_language
                        translated_languages
                        authors
                        artists
                        content_rating_id
                        type_id
                        demographic_ids
                        genre_ids
                        format_ids
                        year
                        type
                        status
                        description
                        cover_local_url
                        cover_url
                        urlPath
                        total_chapters
                        total_follows
                        total_reviews
                        total_comments
                        vote_avg
                        vote_users
                        vote_val
                        chap_last_public_at
                        is_merged
                        merged_to
                        comic_ids
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
        }
    }
`;

const COMIC_PROBE_QUERY = `
    query get_comicNode($id: ID!) {
        get_comicNode(id: $id) {
            id
            data {
                subName
                dbStatus
                isPublic
                translatedLanguage
                chaps_normal
                chapterNode_up_to {
                    data {
                        datePublic
                    }
                }
            }
        }
    }
`;

const CHAPTER_LIST_FIELDS = `
            paging { next total }
            items {
                id
                data {
                    id
                    dbStatus
                    isFinal
                    volume
                    serial
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
                    srcTitle
                    srcColor
                    comments_topic
                    comments_total
                    views_login
                    views_guest
                }
            }
`;

const CHAPTER_LIST_QUERY = `
    query get_comic_chapterList_fullList($select: Select_Comic_ChapterList) {
        get_comic_chapterList_fullList(select: $select) {
${CHAPTER_LIST_FIELDS}
        }
    }
`;

const CHAPTER_UNIQ_LIST_QUERY = `
    query get_comic_chapterList_uniqList($select: Select_Comic_ChapterList_UniqList) {
        get_comic_chapterList_uniqList(select: $select) {
${CHAPTER_LIST_FIELDS}
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

const ID_QUERY_REGEX = /^id\s*:?\s*([a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?)\s*$/i;

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

interface TitleBrowsePagerData {
  get_title_browse_pager?: { next?: number | null; total?: number | null } | null;
}

interface ChapterUpToNode {
  data?: { datePublic?: number | null } | null;
}

interface ComicProbeData {
  subName?: string | null;
  dbStatus?: string | null;
  isPublic?: boolean | null;
  translatedLanguage?: string | null;
  chaps_normal?: number | null;
  chapterNode_up_to?: ChapterUpToNode | null;
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
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
  originalStatus?: string | null;
  uploadStatus?: string | null;
  type?: string | null;
  demographics?: string[] | null;
  contentRating?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
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
  chapterNode_up_to?: ChapterUpToNode | null;
  summary?: { text?: string | null } | null;
  extraInfo?: { text?: string | null } | null;
  readDirection?: string | null;
  urlPath?: string | null;
  urlCover?: string | null;
  originalPubZone?: string | null;
  originalPubFrom?: { y?: number | null; m?: number | null; d?: number | null } | null;
  originalPubTill?: { y?: number | null; m?: number | null; d?: number | null } | null;
  trackingSites?: {
    mangaupdates?: string | null;
    myanimelist?: string | null;
    animeplanet?: string | null;
    anilist?: string | null;
    kitsu?: string | null;
  } | null;
  titleNode?: { id?: string | null; data?: TitleNodeData | null } | null;
}

interface ChapterData {
  id: string;
  dname?: string | null;
  title?: string | null;
  urlPath?: string | null;
  dateCreate?: number | null;
  datePublic?: number | null;
  dateModify?: number | null;
  chaNum?: number | null;
  volNum?: number | null;
  serial?: number | null;
  count_images?: number | null;
  is_new?: boolean | null;
  srcName?: string | null;
}

interface ChapterItem {
  id: string;
  data: ChapterData;
}

type ComicChapter = Chapter & { comicId?: string };

interface ChapterEdition {
  comicId: string;
  label: string | null;
  lastPublicAt: number | null;
  chapterCount: number | null;
  translatedLanguage: string | null;
}

function toTitleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.toLowerCase().replace(/^./, (c) => c.toUpperCase()))
    .join(' ');
}

function languageLabel(code: string): string {
  const entry = LANGUAGES.find(([, c]) => c === code);
  return entry ? entry[0] : code;
}

function toMarkdownUrls(text: string): string {
  return text.replace(/(?<!\[|\()https?:\/\/[^\s<"]+/g, (m) => `[${m}](${m})`);
}

function normalizeEditionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

export class XCOMICScraper extends BaseScraper {
  readonly name = 'XCOMIC';
  readonly baseUrl = 'https://xcomic.me';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.search('', page, 'field_score');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.search('', page, 'field_update');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const idMatch = ID_QUERY_REGEX.exec(query.trim());
    if (idMatch) {
      const id = idMatch[1];
      const manga = await this.resolveIdLookup(id);
      if (!manga) throw new Error(`XCOMIC: entry id '${id}' not found`);
      return { mangas: [manga], hasNextPage: false };
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
    const [itemsData, pagerData] = await Promise.all([
      this.graphql<TitleBrowseData>(TITLE_BROWSE_QUERY, variables),
      this.graphql<TitleBrowsePagerData>(TITLE_BROWSE_PAGER_QUERY, variables),
    ]);
    const titles = itemsData?.get_title_browse_items ?? [];
    if (titles.length === 0) return { mangas: [], hasNextPage: false };
    const mangas: Manga[] = titles.map((t) => {
      const title = (t.data?.title ?? '').replace(/\([^()]*\)|\{[^{}]*\}|\[(?:(?!]).)*]/gi, '').trim();
      const tid = t.id ?? '';
      const cover = t.data?.cover_local_url ?? t.data?.cover_url ?? '';
      return {
        title: title || tid,
        url: tid,
        thumbnailUrl: cover ? this.absUrl(cover) : '',
        lang: this.lang,
      };
    });
    const pager = pagerData?.get_title_browse_pager;
    const hasNextPage = (pager?.next ?? 0) !== 0;
    return { mangas: mangas.length > 0 ? mangas : [], hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const title = await this.resolveStoredTitleNode(mangaUrl);
    if (!title) throw new Error('XCOMIC: title not found');
    const editions = await this.resolveTargetComics(title);
    const bestComicId = editions.bestComicId ?? title.comic_ids?.[0] ?? null;
    if (!bestComicId) return {};
    const comic = await this.fetchComicNode(bestComicId);
    if (!comic) return {};
    return this.comicToMangaChecked(comic, title, mangaUrl);
  }

  private async resolveIdLookup(id: string): Promise<Manga | null> {
    const title = await this.resolveStoredTitleNode(id);
    if (!title) return null;
    const titleId = title.id ?? id;
    const manga: Manga = {
      title: (title.title ?? '').replace(/\([^()]*\)|\{[^{}]*\}|\[(?:(?!]).)*]/gi, '').trim() || titleId,
      url: titleId,
      thumbnailUrl: title.cover_local_url ?? title.cover_url ? this.absUrl(title.cover_local_url ?? title.cover_url ?? '') : '',
      lang: this.lang,
    };
    const editions = await this.resolveTargetComics(title);
    const bestComicId = editions.bestComicId ?? title.comic_ids?.[0] ?? null;
    if (bestComicId) {
      const comic = await this.fetchComicNode(bestComicId);
      if (comic) return { ...this.comicToManga(comic, title), url: titleId };
    }
    return manga;
  }

  private async resolveStoredTitleNode(storedUrl: string): Promise<TitleNodeData | null> {
    const ids = storedUrl.split(':').map((s) => s.trim()).filter((s) => s.length > 0);
    const distinct = [...new Set(ids)];
    if (distinct.length === 0) return null;
    const first = await this.fetchResolvedTitleNode(distinct[0]);
    if (first) return first;
    for (const comicId of distinct) {
      const comic = await this.fetchComicNode(comicId);
      const parentId = comic?.titleNode?.data?.id;
      if (parentId) {
        const resolved = await this.fetchResolvedTitleNode(parentId);
        if (resolved) return resolved;
      }
    }
    return null;
  }

  private async fetchResolvedTitleNode(id: string): Promise<TitleNodeData | null> {
    const title = await this.fetchTitleNode(id);
    if (!title) return null;
    const mergedId = title.is_merged === true && title.merged_to && title.merged_to !== id ? title.merged_to : null;
    if (mergedId) {
      const merged = await this.fetchTitleNode(mergedId);
      if (merged) return merged;
    }
    return title;
  }

  private async resolveTargetComics(title: TitleNodeData): Promise<TitleEditions> {
    const comicIds = (title.comic_ids ?? []).filter((id) => id && id.trim().length > 0);
    const expectedLang = this.lang === 'all' ? null : this.mapLangCode(this.lang);
    const probes: [string, ComicProbeData][] = [];
    for (let i = 0; i < comicIds.length; i += COMIC_PROBES_PER_TITLE) {
      const batch = comicIds.slice(i, i + COMIC_PROBES_PER_TITLE);
      const results = await Promise.all(batch.map(async (cid) => [cid, await this.fetchComicProbe(cid)] as [string, ComicProbeData | null]));
      for (const [cid, p] of results) if (p) probes.push([cid, p]);
    }
    const editions = probes
      .filter(([, p]) => this.isLiveProbe(p) && (expectedLang == null || p.translatedLanguage === expectedLang))
      .map(([cid, p]) => ({
        comicId: cid,
        label: normalizeEditionLabel(p.subName),
        lastPublicAt: p.chapterNode_up_to?.data?.datePublic ?? null,
        chapterCount: p.chaps_normal ?? null,
        translatedLanguage: p.translatedLanguage ?? null,
      }))
      .sort((a, b) => (a.comicId < b.comicId ? -1 : 1));
    return new TitleEditions(editions);
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

  private isLiveProbe(p: ComicProbeData): boolean {
    return p.isPublic !== false && (p.dbStatus == null || p.dbStatus === 'normal');
  }

  private async fetchAllChapters(editions: ChapterEdition[]): Promise<ComicChapter[]> {
    const out: Chapter[] = [];
    for (let i = 0; i < editions.length; i += COMIC_PROBES_PER_TITLE) {
      const batch = editions.slice(i, i + COMIC_PROBES_PER_TITLE);
      const results = await Promise.all(batch.map((e) => this.fetchChapterList(e.comicId, e.label)));
      for (const chapters of results) out.push(...chapters);
    }
    return this.disambiguateEditionLabels(out);
  }

  private disambiguateEditionLabels(chapters: ComicChapter[]): ComicChapter[] {
    const byLabel = new Map<string, Set<string>>();
    for (const ch of chapters) {
      const label = ch.scanlator ?? null;
      if (!label) continue;
      const set = byLabel.get(label.toLowerCase()) ?? new Set<string>();
      if (ch.comicId) set.add(ch.comicId);
      byLabel.set(label.toLowerCase(), set);
    }
    const colliding = new Set<string>();
    for (const [label, ids] of byLabel) if (ids.size > 1) colliding.add(label);
    for (const ch of chapters) {
      const label = ch.scanlator ?? null;
      if (label && ch.comicId && colliding.has(label.toLowerCase())) {
        ch.scanlator = `${label} [${ch.comicId}]`;
      }
    }
    return chapters;
  }

  private async fetchChapterList(comicId: string, editionLabel: string | null): Promise<ComicChapter[]> {
    const first = await this.fetchChapterListPage(comicId, 1, editionLabel);
    const all = [...first.chapters];
    const total = first.total ?? all.length;
    const totalPages = Math.max(1, Math.ceil(total / CHAPTER_PAGE_SIZE));
    for (let start = 2; start <= totalPages; start += 3) {
      const batch: Promise<{ chapters: Chapter[] }>[] = [];
      for (let p = start; p < start + 3 && p <= totalPages; p++) batch.push(this.fetchChapterListPage(comicId, p, editionLabel));
      const pages = await Promise.all(batch);
      for (const page of pages) all.push(...page.chapters);
    }
    return all;
  }

  private async fetchChapterListPage(comicId: string, page: number, editionLabel: string | null): Promise<{ chapters: ComicChapter[]; total: number | null }> {
    const variables = { select: { comic_id: comicId, page, size: CHAPTER_PAGE_SIZE, sortby: 'chapter_desc' } };
    const parse = (data: Record<string, unknown>, key: string) => {
      const resp = data[key] as { paging?: { next?: number | null; total?: number | null } | null; items?: ChapterItem[] | null } | undefined;
      if (!resp) return null;
      const items = resp.items ?? [];
      return { chapters: items.map((it) => this.chapterToChapter(it, comicId, editionLabel)), total: resp.paging?.total ?? null };
    };
    try {
      const data = await this.graphql<Record<string, unknown>>(CHAPTER_UNIQ_LIST_QUERY, variables);
      const parsed = parse(data, 'get_comic_chapterList_uniqList');
      if (parsed) return parsed;
      throw new Error('uniq list missing');
    } catch {
      const data = await this.graphql<Record<string, unknown>>(CHAPTER_LIST_QUERY, variables);
      const parsed = parse(data, 'get_comic_chapterList_fullList');
      if (parsed) return parsed;
      return { chapters: [], total: null };
    }
  }

  private chapterToChapter(item: ChapterItem, comicId: string, editionLabel: string | null): ComicChapter {
    const d = item.data;
    const displayName = d.dname ?? '';
    const nameParts: string[] = [];
    const number = (d.chaNum ?? d.serial ?? d.volNum)?.toString().replace(/\.0$/, '');
    if (number != null && !displayName.includes(number)) nameParts.push(`Chapter ${number}`);
    if (displayName) nameParts.push(displayName);
    if (d.title) nameParts.push(d.title);
    const name = nameParts.join(': ');
    let scanlator: string | undefined;
    const uploader = d.srcName ? d.srcName.replace(/^./, (c) => c.toUpperCase()) : undefined;
    scanlator = editionLabel ?? uploader;
    const chapter: ComicChapter = {
      name,
      url: item.id,
      chapterNumber: d.chaNum ?? undefined,
      dateUpload: d.dateModify ?? d.dateCreate ?? d.datePublic ?? undefined,
      scanlator,
      comicId,
    };
    return chapter;
  }

  private async comicToManga(node: ComicNode, work: TitleNodeData): Promise<Manga> {
    const genreSet = new Set<string>();
    const workType = work.type ?? node.type;
    if (workType) genreSet.add(toTitleCase(workType));
    (work.demographic_ids ?? node.demographics)?.forEach((d) => genreSet.add(toTitleCase(d)));
    (work.genre_ids ?? node.genres)?.forEach((g) => genreSet.add(toTitleCase(g)));
    (work.content_rating_id ? [work.content_rating_id] : node.contentRating ? [node.contentRating] : []).forEach((c) => genreSet.add(toTitleCase(c)));
    work.format_ids?.forEach((g) => genreSet.add(toTitleCase(g)));
    const status = this.mapStatus(work.status ?? node.originalStatus ?? node.uploadStatus, node.uploadStatus);
    const cover = work.cover_local_url ?? work.cover_url ?? node.urlCover ?? '';
    const authors = work.authors ?? null;
    const artists = work.artists ?? null;
    return {
      title: (work.title ?? node.name).replace(/\([^()]*\)|\{[^{}]*\}|\[(?:(?!]).)*]/gi, '').trim(),
      url: '',
      thumbnailUrl: cover ? this.absUrl(cover) : '',
      lang: this.lang,
      author: authors?.join(', '),
      artist: artists?.join(', '),
      genre: [...genreSet].join(', ') || undefined,
      status,
      description: this.buildDescription(node, work),
    };
  }

  private async comicToMangaChecked(node: ComicNode, work: TitleNodeData, url: string): Promise<Manga> {
    const m = await this.comicToManga(node, work);
    m.url = url;
    return m;
  }

  private buildDescription(node: ComicNode, work: TitleNodeData): string {
    const descParts: string[] = [];
    if (node.is_hot || node.is_new) {
      descParts.push(`${node.is_hot ? '🔥 HOT' : ''}${node.is_hot && node.is_new ? ' ' : ''}${node.is_new ? '✨ NEW' : ''}`);
    }
    const metadata: string[] = [];
    const original = work.original_language ?? node.originalLanguage;
    if (original) metadata.push(`**Original**: ${languageLabel(original)}`);
    const translated = (work.translated_languages ?? []).filter((x): x is string => !!x);
    if (translated.length > 0) metadata.push(`**Translated**: ${translated.map(languageLabel).join(', ')}`);
    else if (node.translatedLanguage) metadata.push(`**Translated**: ${languageLabel(node.translatedLanguage)}`);
    if (node.originalPubZone) metadata.push(`**Region**: ${node.originalPubZone}`);
    if (work.year) metadata.push(`**Released**: ${work.year}`);
    if (node.readDirection) {
      const label = READ_DIRECTION_LABELS.find(([code]) => code === node.readDirection)?.[1] ?? node.readDirection;
      metadata.push(`**Read Direction**: ${label}`);
    }
    if (work.chap_last_public_at) metadata.push(`**Updated**: ${new Date(work.chap_last_public_at).toISOString().slice(0, 10)}`);
    if (metadata.length > 0) descParts.push(metadata.join('\n'));
    const stats: string[] = [];
    const score = node.score_val;
    if (score && score > 0) stats.push(`**Score**: ${score.toFixed(1)}`);
    const follows = work.total_follows ?? null;
    if (follows && follows > 0) stats.push(`**Follows**: ${follows}`);
    const reviews = work.total_reviews ?? null;
    if (reviews && reviews > 0) stats.push(`**Reviews**: ${reviews}`);
    const comments = work.total_comments ?? null;
    if (comments && comments > 0) stats.push(`**Comments**: ${comments}`);
    const chaps = work.total_chapters ?? node.chaps_normal ?? null;
    if (chaps && chaps > 0) stats.push(`**Chapters**: ${chaps}`);
    if (stats.length > 0) descParts.push(`**Statistics**\n${stats.join(' · ')}`);
    const desc = work.description ?? node.summary?.text ?? null;
    if (desc) descParts.push(`**Description**\n${toMarkdownUrls(desc)}`);
    const links: string[] = [];
    const wts = work.tracking_sites;
    if (wts?.anilist) links.push(`[AniList](https://anilist.co/manga/${wts.anilist})`);
    if (wts?.myanimelist) links.push(`[MyAnimeList](https://myanimelist.net/manga/${wts.myanimelist})`);
    if (wts?.mangaupdates) links.push(`[MangaUpdates](https://www.mangaupdates.com/series/${wts.mangaupdates})`);
    if (wts?.kitsu) links.push(`[Kitsu](https://kitsu.app/manga/${wts.kitsu})`);
    if (wts?.animeplanet) links.push(`[Anime-Planet](https://www.anime-planet.com/manga/${wts.animeplanet})`);
    if (node.trackingSites?.anilist && !wts?.anilist) links.push(`[AniList](https://anilist.co/manga/${node.trackingSites.anilist})`);
    if (node.trackingSites?.myanimelist && !wts?.myanimelist) links.push(`[MyAnimeList](https://myanimelist.net/manga/${node.trackingSites.myanimelist})`);
    if (links.length > 0) descParts.push(`**External Links**:\n${links.map((l) => `- ${l}`).join('\n')}`);
    const alts = [work.native_title, work.romanized_title, ...(work.alt_titles ?? [])].filter((a): a is string => !!a && a !== work.title);
    if (alts.length > 0) descParts.push(`**Alternative Titles**:\n${alts.map((a) => `- ${a}`).join('\n')}`);
    if (node.extraInfo?.text) descParts.push(`**Extra Info**:\n${node.extraInfo.text}`);
    return descParts.join('\n\n');
  }

  private mapStatus(status: string | null | undefined, uploadStatus: string | null | undefined): 0 | 1 | 2 | 3 {
    const s = status?.toLowerCase();
    if (!s) return 0;
    if (s.includes('pending')) return 0;
    if (s.includes('ongoing') || s.includes('releasing')) return 1;
    if (s.includes('cancelled')) return 3;
    if (s.includes('hiatus')) return 0;
    if (s.includes('completed')) return 2;
    return 0;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const title = await this.resolveStoredTitleNode(mangaUrl);
    if (!title) return [];
    const editions = await this.resolveTargetComics(title);
    if (editions.sources.length === 0) return [];
    const chapters = await this.fetchAllChapters(editions.sources);
    chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
    return chapters;
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
      const payload = await this.graphql<unknown>(COMIC_NODE_QUERY, { id });
      const resp = (payload as Record<string, unknown>)['get_comicNode'] as { id?: string; data?: Record<string, unknown> } | undefined;
      const d = resp?.data;
      if (!d) return null;
      const titleNodeWrapper = d['title_titleNode'] as { id?: string | null; data?: TitleNodeData | null } | null | undefined;
      const node = { ...(d as object), id: (d['id'] as string) ?? resp?.id ?? id, titleNode: titleNodeWrapper ?? null } as unknown as ComicNode;
      return node;
    } catch { return null; }
  }

  private async fetchComicProbe(id: string): Promise<ComicProbeData | null> {
    try {
      const payload = await this.graphql<{ get_comicNode: { data: ComicProbeData } }>(COMIC_PROBE_QUERY, { id });
      return payload?.get_comicNode?.data ?? null;
    } catch { return null; }
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

class TitleEditions {
  constructor(public sources: ChapterEdition[]) {}
  get bestComicId(): string | null {
    const best = [...this.sources].sort((a, b) => (b.chapterCount ?? Number.MIN_SAFE_INTEGER) - (a.chapterCount ?? Number.MIN_SAFE_INTEGER))[0];
    return best?.comicId ?? null;
  }
}
