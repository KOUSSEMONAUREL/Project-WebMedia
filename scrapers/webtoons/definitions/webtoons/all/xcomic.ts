import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const BROWSE_PAGE_SIZE = 36;
const CHAPTER_PAGE_SIZE = 1000;
const LATEST_API_PAGES_MAX = 10;

const READ_DIRECTION_LABELS: [string, string][] = [
  ['ttb', '⬇️ Top To Bottom'],
  ['rtl', '⬅️ Right To Left'],
  ['ltr', '➡️ Left To Right'],
];

const COMIC_ITEMS_QUERY = `
query get_comic_browse_items($select: Comic_Browse_Select) {
    get_comic_browse_items(select: $select) {
        data {
            id
            name
            urlPath
            urlCover
        }
    }
}
`;

const COMIC_NODE_QUERY = `
query get_comicNode($id: ID!) {
    get_comicNode(id: $id) {
        data {
            id
            name
            altNames
            authors
            authorNodes {
                id
                data {
                    id
                    name
                }
            }
            artists
            artistNodes {
                id
                data {
                    id
                    name
                }
            }
            originalLanguage
            translatedLanguage
            originalStatus
            originalPubFrom { y m d }
            originalPubTill { y m d }
            originalPubZone
            uploadStatus
            type
            demographics
            contentRating
            genres
            tags
            tagNodes {
                id
                data {
                    id
                    name
                }
            }
            publishers
            publisherNodes {
                id
                data {
                    id
                    name
                }
            }
            is_hot
            is_new
            follows
            reviews
            comments_total
            score_val
            chaps_normal
            trackingSites {
                mangaupdates
                myanimelist
                animeplanet
                anilist
                kitsu
            }
            summary {
                text
            }
            extraInfo {
                text
            }
            readDirection
            urlPath
            urlCover
        }
    }
}
`;

const CHAPTER_LIST_QUERY = `
query get_comic_chapterList_uniqList($select: Select_Comic_ChapterList_UniqList) {
    get_comic_chapterList_uniqList(select: $select) {
        paging {
            next
            total
        }
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
                serial
                srcName
                profileNodes {
                    data {
                        name
                    }
                }
            }
        }
    }
}
`;

const LATEST_UPLOADS_QUERY = `
query get_comic_latestUploads($select: Comic_LatestUploads_Select) {
    get_comic_latestUploads(select: $select) {
        before
        items {
            comic {
                id
                data {
                    id
                    name
                    urlPath
                    urlCover
                    translatedLanguage
                    genres
                }
            }
            chapters(amount: 1) {
                id
                data {
                    id
                    datePublic
                }
            }
        }
    }
}
`;

const CHAPTER_PAGES_QUERY = `
query($id: ID!) {
    get_chapterNode(id: $id) {
        id
        data {
            imageUrls
        }
    }
}
`;

const ID_QUERY_REGEX = /^id\s*:?\s*([a-zA-Z0-9-_]+)\s*$/i;

const LANGUAGES: [string, string][] = [
  ['English', 'en'], ['French', 'fr'], ['Portuguese', 'pt'], ['Korean', 'ko'],
  ['Japanese', 'ja'], ['Indonesian', 'id'], ['Chinese', 'zh'], ['Abkhazian', 'ab'],
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
  ['Slovenian', 'sl'], ['Vietnamese', 'vi'], ['Other', '_t'], ['Uzbek', 'uz'],
  ['Zulu', 'zu'],
];

interface ComicNode {
  id: string;
  name: string;
  altNames?: string[] | null;
  authors?: string[] | null;
  authorNodes?: { data: { name: string } | null }[] | null;
  artists?: string[] | null;
  artistNodes?: { data: { name: string } | null }[] | null;
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
  originalStatus?: string | null;
  originalPubFrom?: { y?: number | null; m?: number | null; d?: number | null } | null;
  originalPubTill?: { y?: number | null; m?: number | null; d?: number | null } | null;
  originalPubZone?: string | null;
  uploadStatus?: string | null;
  type?: string | null;
  demographics?: string[] | null;
  contentRating?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
  tagNodes?: { data: { name: string } | null }[] | null;
  publishers?: string[] | null;
  publisherNodes?: { data: { name: string } | null }[] | null;
  is_hot?: boolean | null;
  is_new?: boolean | null;
  follows?: number | null;
  reviews?: number | null;
  comments_total?: number | null;
  score_val?: number | null;
  chaps_normal?: number | null;
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
  serial?: number | null;
  srcName?: string | null;
  profileNodes?: { data: { name: string } | null }[] | null;
}

interface ChapterItem {
  id: string;
  data: ChapterData;
}

interface LatestUploadsItem {
  comic?: { id: string; data?: ComicNode | null } | null;
  chapters?: { id: string; data?: ChapterData | null }[] | null;
}

interface LatestUploadsData {
  before?: number | null;
  items: LatestUploadsItem[] | null;
}

function dateToString(date: { y?: number | null; m?: number | null; d?: number | null }): string {
  let out = '';
  if (date.y != null) out += String(date.y);
  if (date.m != null) out += `-${String(date.m).padStart(2, '0')}`;
  if (date.d != null) out += `-${String(date.d).padStart(2, '0')}`;
  return out;
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

export class XCOMICScraper extends BaseScraper {
  readonly name = 'XCOMIC';
  readonly baseUrl = 'https://xcomic.me';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.search('', page, 'field_score');
  }

  private latestCursor: number | null = null;

  async getLatest(page = 1): Promise<SearchResult> {
    if (page === 1) this.latestCursor = null;

    const accumulated: Manga[] = [];
    const seenUrls = new Set<string>();
    let hasNextPage = true;
    let apiPageCount = 0;

    while (accumulated.length === 0 && hasNextPage && apiPageCount < LATEST_API_PAGES_MAX) {
      apiPageCount++;
      const data = await this.graphql<{ get_comic_latestUploads: LatestUploadsData | null }>(
        LATEST_UPLOADS_QUERY,
        { select: { size: BROWSE_PAGE_SIZE, before: this.latestCursor } },
      );
      const result = data?.get_comic_latestUploads;
      if (!result) throw new Error('XCOMIC: latest uploads not found');

      for (const item of result.items ?? []) {
        const node = item.comic?.data;
        if (!node) continue;
        const manga = this.latestItemToManga(node);
        if (!seenUrls.has(manga.url)) {
          seenUrls.add(manga.url);
          accumulated.push(manga);
        }
      }

      this.latestCursor = result.before ?? null;
      hasNextPage = this.latestCursor !== null;
    }

    return { mangas: accumulated, hasNextPage };
  }

  private latestItemToManga(node: Pick<ComicNode, 'id' | 'name' | 'urlCover'>): Manga {
    return {
      title: node.name,
      url: node.id,
      thumbnailUrl: node.urlCover ? this.absUrl(node.urlCover) : '',
      lang: this.lang,
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const idMatch = ID_QUERY_REGEX.exec(query.trim());
    if (idMatch) {
      const id = idMatch[1].split('-')[0];
      return { mangas: [this.nodeToManga(await this.fetchComicNode(id))], hasNextPage: false };
    }
    return this.search(query, page, null);
  }

  private async search(word: string, page: number, sortby: string | null): Promise<SearchResult> {
    const variables = {
      select: {
        page,
        size: BROWSE_PAGE_SIZE,
        init: (page - 1) * BROWSE_PAGE_SIZE,
        sortby,
        word,
        where: 'browse',
        releaseYearMin: null,
        releaseYearMax: null,
        incTypes: [] as string[],
        incDemographics: [] as string[],
        incContentRatings: [] as string[],
        incGenres: [] as string[],
        excGenres: [] as string[],
        incGenresMode: null,
        excGenresMode: null,
        incOLangs: [] as string[],
        incTLangs: [] as string[],
        origStatus: null,
        siteStatus: null,
        chapCount: null,
        ignoreGlobalGenres: false,
        ignoreGlobalULangs: false,
        ignoreGlobalBlocks: false,
      },
    };
    const data = await this.graphql<{ get_comic_browse_items: { data: ComicNode }[] }>(COMIC_ITEMS_QUERY, variables);
    const items = data?.get_comic_browse_items ?? [];
    const mangas = items.map((item) => this.nodeToManga(item.data));
    return { mangas, hasNextPage: mangas.length >= BROWSE_PAGE_SIZE };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const node = await this.fetchComicNode(mangaUrl);
    return this.nodeToManga(node);
  }

  private async fetchComicNode(id: string): Promise<ComicNode> {
    const data = await this.graphql<{ get_comicNode: { data: ComicNode | null } }>(COMIC_NODE_QUERY, { id });
    const node = data?.get_comicNode?.data ?? null;
    if (!node) throw new Error('XCOMIC: comic node not found');
    return node;
  }

  private nodeToManga(node: ComicNode): Manga {
    const authorNames = node.authorNodes?.map((n) => n.data?.name).filter((n): n is string => !!n);
    const artistNames = node.artistNodes?.map((n) => n.data?.name).filter((n): n is string => !!n);
    const genreSet = new Set<string>();
    if (node.type) genreSet.add(toTitleCase(node.type));
    node.demographics?.forEach((d) => genreSet.add(toTitleCase(d)));
    if (node.contentRating) genreSet.add(toTitleCase(node.contentRating));
    node.genres?.forEach((g) => genreSet.add(toTitleCase(g)));

    const status = this.mapStatus(node.originalStatus ?? node.uploadStatus, node.uploadStatus);

    const thumbnailUrl = node.urlCover ? this.absUrl(node.urlCover) : '';

    return {
      title: node.name,
      url: node.id,
      thumbnailUrl,
      lang: this.lang,
      author: authorNames && authorNames.length > 0 ? authorNames.join(', ') : undefined,
      artist: artistNames && artistNames.length > 0 ? artistNames.join(', ') : undefined,
      genre: [...genreSet].join(', ') || undefined,
      status,
      description: this.buildDescription(node) || undefined,
    };
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
    if (node.originalPubFrom) {
      const till = node.originalPubTill ? dateToString(node.originalPubTill) : 'Ongoing';
      metadata.push(`**Publication**: ${dateToString(node.originalPubFrom)} - ${till}`);
    }
    if (node.originalPubZone) metadata.push(`**Region**: ${node.originalPubZone}`);
    if (node.readDirection) {
      const label = READ_DIRECTION_LABELS.find(([code]) => code === node.readDirection)?.[1] ?? node.readDirection;
      metadata.push(`**Read Direction**: ${label}`);
    }
    if (metadata.length > 0) {
      desc += metadata.join('\n');
      desc += '\n\n';
    }

    const stats: string[] = [];
    if (node.score_val && node.score_val > 0) stats.push(`**Score**: ${node.score_val.toFixed(1)}`);
    if (node.follows && node.follows > 0) stats.push(`**Follows**: ${node.follows}`);
    if (node.reviews && node.reviews > 0) stats.push(`**Reviews**: ${node.reviews}`);
    if (node.comments_total && node.comments_total > 0) stats.push(`**Comments**: ${node.comments_total}`);
    if (node.chaps_normal && node.chaps_normal > 0) stats.push(`**Chapters**: ${node.chaps_normal}`);
    if (stats.length > 0) {
      desc += `**Statistics**\n${stats.join(' · ')}`;
      desc += '\n\n';
    }

    if (metadata.length > 0) desc += '\n\n---\n\n';

    if (node.summary?.text) {
      desc += this.toMarkdownUrls(node.summary.text);
    }

    const links: string[] = [];
    if (node.trackingSites?.mangaupdates) links.push(`[MangaUpdates](https://www.mangaupdates.com/series.html?id=${node.trackingSites.mangaupdates})`);
    if (node.trackingSites?.myanimelist) links.push(`[MyAnimeList](https://myanimelist.net/manga/${node.trackingSites.myanimelist})`);
    if (node.trackingSites?.animeplanet) links.push(`[Anime-Planet](https://www.anime-planet.com/manga/${node.trackingSites.animeplanet})`);
    if (node.trackingSites?.anilist) links.push(`[AniList](https://anilist.co/manga/${node.trackingSites.anilist})`);
    if (node.trackingSites?.kitsu) links.push(`[Kitsu](https://kitsu.io/manga/${node.trackingSites.kitsu})`);
    if (links.length > 0) {
      if (desc.length > 0) desc += '\n\n';
      desc += '**External Links**:\n';
      desc += links.map((link) => `- ${link}`).join('\n');
    }

    const extras: string[] = [];
    const publisherNames = node.publisherNodes?.map((n) => n.data?.name).filter((n): n is string => !!n);
    const publisherList = publisherNames && publisherNames.length > 0 ? publisherNames : node.publishers;
    if (publisherList && publisherList.length > 0) extras.push(`**Publishers**: ${publisherList.join(', ')}`);
    const tagNames = node.tagNodes?.map((n) => n.data?.name).filter((n): n is string => !!n);
    const tagList = tagNames && tagNames.length > 0 ? tagNames : node.tags;
    if (tagList && tagList.length > 0) extras.push(`**Tags**: ${tagList.join(', ')}`);
    if (extras.length > 0) {
      if (desc.length > 0) desc += '\n\n';
      desc += extras.join('\n\n');
    }

    if (node.altNames && node.altNames.length > 0) {
      if (desc.length > 0) desc += '\n\n';
      desc += '**Alternative Titles**:\n';
      desc += node.altNames.map((name) => `- ${name}`).join('\n');
    }

    if (node.extraInfo?.text) {
      if (desc.length > 0) desc += '\n\n**Extra Info**:\n';
      desc += this.toMarkdownUrls(node.extraInfo.text);
    }

    return desc.trim();
  }

  private toMarkdownUrls(text: string): string {
    return text.replace(/(?<!\[|\()https?:\/\/[^\s<"]+/g, (m) => `[${m}](${m})`);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = mangaUrl.split('#')[0];
    const firstPage = await this.fetchChapterListPage(id, 1);
    const allChapters = [...firstPage.chapters];
    const totalItems = firstPage.total ?? 0;

    if (totalItems > CHAPTER_PAGE_SIZE && firstPage.hasNextPage) {
      const totalPages = Math.ceil(totalItems / CHAPTER_PAGE_SIZE);
      for (let start = 2; start <= totalPages; start += 3) {
        const batch = [];
        for (let p = start; p < start + 3 && p <= totalPages; p++) batch.push(this.fetchChapterListPage(id, p));
        const pages = await Promise.all(batch);
        for (const page of pages) allChapters.push(...page.chapters);
      }
    }

    return allChapters;
  }

  private async fetchChapterListPage(comicId: string, page: number): Promise<{ chapters: Chapter[]; total: number | null; hasNextPage: boolean }> {
    const variables = {
      select: {
        comic_id: comicId,
        page,
        size: CHAPTER_PAGE_SIZE,
        sortby: 'chapter_desc',
      },
    };
    const data = await this.graphql<{
      get_comic_chapterList_uniqList: {
        paging: { next: number | null; total: number | null } | null;
        items: ChapterItem[] | null;
      } | null;
    }>(CHAPTER_LIST_QUERY, variables);
    const response = data?.get_comic_chapterList_uniqList;
    if (!response) throw new Error('XCOMIC: chapter list not found');
    const items: ChapterItem[] = response.items ?? [];
    const chapters = items.map((item) => this.chapterToChapter(item));
    return {
      chapters,
      total: response.paging?.total ?? null,
      hasNextPage: (response.paging?.next ?? 0) !== 0,
    };
  }

  private chapterToChapter(item: ChapterItem): Chapter {
    const d = item.data;
    const displayName = d.dname ?? '';
    const nameParts: string[] = [];
    const number = (d.chaNum ?? d.serial)?.toString().replace(/\.0$/, '');
    if (number != null && !displayName.includes(number)) nameParts.push(`Chapter ${number}`);
    if (displayName) nameParts.push(displayName);
    if (d.title) nameParts.push(d.title);
    const name = nameParts.join(': ');

    let scanlator: string | undefined;
    if (d.srcName && d.srcName.length > 0) {
      scanlator = d.srcName.replace(/^./, (c) => c.toUpperCase());
    } else {
      const profiles = d.profileNodes?.map((n) => n.data?.name).filter((n): n is string => !!n);
      if (profiles && profiles.length > 0) scanlator = profiles.join(', ');
    }

    return {
      name,
      url: item.id,
      chapterNumber: d.chaNum ?? d.serial ?? undefined,
      dateUpload: d.dateModify ?? d.dateCreate ?? d.datePublic ?? undefined,
      scanlator,
    };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const id = chapterUrl.split('#')[0];
    const data = await this.graphql<{ get_chapterNode: { data: { imageUrls: string[] | null } | null } | null }>(CHAPTER_PAGES_QUERY, { id });
    const imageUrls = data?.get_chapterNode?.data?.imageUrls ?? [];
    return imageUrls.map((url, index) => ({
      index,
      imageUrl: url.startsWith('http') ? url : this.absUrl(url),
    }));
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.post('/query/', { query, variables }, {
      headers: {
        'Content-Type': 'application/json',
        Origin: this.baseUrl,
        Referer: `${this.baseUrl}/`,
      },
    });
    const json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const errors: { message?: string }[] | null = json?.errors ?? null;
    if (errors && errors.length > 0) {
      throw new Error(errors.map((e) => e.message ?? 'GraphQL error').join('\n'));
    }
    return (json?.data ?? {}) as T;
  }
}
