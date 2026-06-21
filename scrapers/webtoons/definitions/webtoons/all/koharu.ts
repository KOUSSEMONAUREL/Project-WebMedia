import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_DOMAIN = 'https://api.schale.network';
const API_BOOKS_URL = `${API_DOMAIN}/books`;
const PREFIX_ID_KEY_SEARCH = 'id:';

interface Entry {
  id: number;
  key: string;
  title: string;
  thumbnail: { path: string };
}

interface Books {
  entries: Entry[];
  total: number;
  limit: number;
  page: number;
}

interface Tag {
  name: string;
  namespace: number;
}

interface Thumbnails {
  base: string;
  main: { path: string };
  entries: { path: string }[];
}

interface MangaDetail {
  id: number;
  title: string;
  key: string;
  created_at: number;
  updated_at?: number;
  thumbnails: Thumbnails;
  tags: Tag[];
}

interface DataKey {
  id?: number;
  size?: number;
  key?: string;
}

interface Data {
  '0': DataKey;
  '780'?: DataKey;
  '980'?: DataKey;
  '1280'?: DataKey;
  '1600'?: DataKey;
}

interface MangaData {
  data: Data;
  similar: Entry[];
}

interface ImagePath {
  path: string;
}

interface ImagesInfo {
  base: string;
  entries: ImagePath[];
}

function capitalizeEach(s: string): string {
  return s.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

function emptyToNull<T>(coll: T[]): T[] | null {
  return coll.length > 0 ? coll : null;
}

const shortenTitleRegex = /(\[[^\]*]|[({][^)}]*[)}])/;

function shortenTitle(title: string): string {
  return title.replace(shortenTitleRegex, '').trim();
}

export class KoharuScraper extends BaseScraper {
  readonly name = 'SchaleNetwork';
  readonly baseUrl = 'https://schale.network';
  readonly lang = 'all';

  private getHeaders(): Record<string, string> {
    return {
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
    };
  }

  async getPopular(page: number): Promise<SearchResult> {
    const url = new URL(API_BOOKS_URL);
    url.searchParams.set('sort', '8');
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString(), this.getHeaders());
    const data = res.data as Books;
    return {
      mangas: data.entries.map(e => this.entryToManga(e)),
      hasNextPage: data.page * data.limit < data.total,
    };
  }

  async getLatest(page: number): Promise<SearchResult> {
    const url = new URL(API_BOOKS_URL);
    url.searchParams.set('page', String(page));
    const res = await this.get(url.toString(), this.getHeaders());
    const data = res.data as Books;
    return {
      mangas: data.entries.map(e => this.entryToManga(e)),
      hasNextPage: data.page * data.limit < data.total,
    };
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    const p = page ?? 1;

    if (query.startsWith('https://')) {
      const url = new URL(query);
      const id = `${url.pathname.split('/')[1]}/${url.pathname.split('/')[2]}`;
      return this.getSearch(`${PREFIX_ID_KEY_SEARCH}${id}`, p);
    }

    if (query.startsWith(PREFIX_ID_KEY_SEARCH)) {
      const ipk = query.replace(PREFIX_ID_KEY_SEARCH, '');
      const res = await this.get(`${API_BOOKS_URL}/detail/${ipk}`, this.getHeaders());
      const manga = await this.getMangaDetail(ipk);
      return { mangas: [manga], hasNextPage: false };
    }

    const url = new URL(API_BOOKS_URL);
    const terms: string[] = [];
    if (query.trim()) terms.push(`title:"${query}"`);
    if (terms.length > 0) url.searchParams.set('s', terms.join(' '));
    url.searchParams.set('page', String(p));
    const res = await this.get(url.toString(), this.getHeaders());
    const data = res.data as Books;
    return {
      mangas: data.entries.map(e => this.entryToManga(e)),
      hasNextPage: data.page * data.limit < data.total,
    };
  }

  async getMangaDetail(mangaUrl: string): Promise<Manga> {
    const res = await this.get(`${API_BOOKS_URL}/detail/${mangaUrl}`, this.getHeaders());
    const detail = res.data as MangaDetail;
    return this.detailToManga(detail);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(`${API_BOOKS_URL}/detail/${mangaUrl}`, this.getHeaders());
    const detail = res.data as MangaDetail;
    return [{
      name: 'Chapter',
      url: `${detail.id}/${detail.key}`,
      chapterNumber: 1,
      date: detail.updated_at ?? detail.created_at,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.post(`${API_BOOKS_URL}/detail/${chapterUrl}`, this.getHeaders());
    const mangaData = res.data as MangaData;
    const reqUrl = res.url ?? res.config?.url ?? '';
    const matches = /\/detail\/(\d+)\/([a-z\d]+)/.exec(reqUrl);
    if (!matches || matches.length < 3) return [];
    const entryId = matches[1];
    const entryKey = matches[2];
    const imagesInfo = await this.getImagesByMangaData(mangaData, entryId, entryKey);
    return imagesInfo.entries.map((image, index) => ({
      index,
      url: `${imagesInfo.base}/${image.path}?w=1280`,
    }));
  }

  private entryToManga(entry: Entry): Manga {
    return {
      url: `${entry.id}/${entry.key}`,
      title: shortenTitle(entry.title),
      thumbnail: entry.thumbnail.path,
    };
  }

  private async getImagesByMangaData(entry: MangaData, entryId: string, entryKey: string): Promise<ImagesInfo> {
    const data = entry.data;
    const getIPK = (ori?: DataKey, alt1?: DataKey, alt2?: DataKey, alt3?: DataKey, alt4?: DataKey): [number?, string?] => [
      ori?.id ?? alt1?.id ?? alt2?.id ?? alt3?.id ?? alt4?.id,
      ori?.key ?? alt1?.key ?? alt2?.key ?? alt3?.key ?? alt4?.key,
    ];
    const [id, publicKey] = getIPK(data['1280'], data['1600'], data['0'], data['980'], data['780']);
    if (id == null || publicKey == null) throw new Error('No Images Found');

    const realQuality = (() => {
      if (id === data['1600']?.id) return '1600';
      if (id === data['1280']?.id) return '1280';
      if (id === data['980']?.id) return '980';
      if (id === data['780']?.id) return '780';
      return '0';
    })();

    const imagesRes = await this.get(
      `${API_BOOKS_URL}/data/${entryId}/${entryKey}/${id}/${publicKey}/${realQuality}`,
      this.getHeaders(),
    );
    return imagesRes.data as ImagesInfo;
  }

  private detailToManga(detail: MangaDetail): Manga {
    const artists: string[] = [];
    const circles: string[] = [];
    const parodies: string[] = [];
    const magazines: string[] = [];
    const characters: string[] = [];
    const cosplayers: string[] = [];
    const females: string[] = [];
    const males: string[] = [];
    const mixed: string[] = [];
    const language: string[] = [];
    const other: string[] = [];
    const uploaders: string[] = [];
    const tags: string[] = [];

    for (const tag of detail.tags) {
      switch (tag.namespace) {
        case 1: artists.push(tag.name); break;
        case 2: circles.push(tag.name); break;
        case 3: parodies.push(tag.name); break;
        case 4: magazines.push(tag.name); break;
        case 5: characters.push(tag.name); break;
        case 6: cosplayers.push(tag.name); break;
        case 7: if (tag.name !== 'anonymous') uploaders.push(tag.name); break;
        case 8: males.push(tag.name + ' ♂'); break;
        case 9: females.push(tag.name + ' ♀'); break;
        case 10: mixed.push(tag.name); break;
        case 11: language.push(tag.name); break;
        case 12: other.push(tag.name); break;
        default: tags.push(tag.name); break;
      }
    }

    const joinCapped = (arr: string[]): string => arr.map(capitalizeEach).join(', ');
    const genre = [...artists, ...circles, ...parodies, ...magazines, ...characters, ...cosplayers, ...tags, ...females, ...males, ...mixed, ...other].map(capitalizeEach).join(', ');
    const author = joinCapped(emptyToNull(circles) ?? artists);
    const artist = joinCapped(artists);

    const descParts: string[] = [];
    if (emptyToNull(circles)) descParts.push(`Circles: ${joinCapped(circles)}`);
    if (emptyToNull(uploaders)) descParts.push(`Uploaders: ${joinCapped(uploaders)}`);
    if (emptyToNull(magazines)) descParts.push(`Magazines: ${joinCapped(magazines)}`);
    if (emptyToNull(cosplayers)) descParts.push(`Cosplayers: ${joinCapped(cosplayers)}`);
    if (emptyToNull(parodies)) descParts.push(`Parodies: ${joinCapped(parodies)}`);
    if (emptyToNull(characters)) descParts.push(`Characters: ${joinCapped(characters)}`);
    descParts.push(`Posted: ${new Date(detail.created_at).toISOString()}`);
    descParts.push(`Pages: ${detail.thumbnails.entries.length}`);

    return {
      url: `${detail.id}/${detail.key}`,
      title: shortenTitle(detail.title),
      thumbnail: detail.thumbnails.base + detail.thumbnails.main.path,
      description: descParts.join('\n'),
      author,
      artist,
      genres: genre,
      status: 1,
    };
  }
}
