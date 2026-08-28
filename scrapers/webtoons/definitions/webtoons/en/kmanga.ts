import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import crypto from 'crypto';

const DOMAIN = 'kmanga.kodansha.com';
const API_URL = `https://api.${DOMAIN}`;
const PAGE_LIMIT = 25;

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf-8').digest('hex');
}

function sha512(s: string): string {
  return crypto.createHash('sha512').update(s, 'utf-8').digest('hex');
}

function getHashedParam(key: string, value: string): string {
  return `${sha256(key)}_${sha512(value)}`;
}

function generateHash(params: Record<string, string>, birthday: string, expires: string): string {
  const sorted = Object.keys(params).sort();
  const parts = sorted.map(k => getHashedParam(k, params[k]));
  const joinedParams = parts.join(',');
  const hash1 = sha256(joinedParams);
  const cookieHash = getHashedParam(birthday, expires);
  return sha512(`${hash1}${cookieHash}`);
}

function getBirthdayCookie(): { value: string; expires: string } {
  return {
    value: '2000-01',
    expires: Math.floor(Date.now() / 1000 + 315360000).toString(),
  };
}

interface RankingTitleId {
  id: number;
}

interface RankingApiResponse {
  ranking_title_list: RankingTitleId[];
}

interface Weekly {
  title_id_list: number[];
  weekday_index: number;
}

interface LatestResponse {
  today_weekday_index: number;
  weekly_list: Weekly[];
  title_list: TitleDetail[];
}

interface TitleDetail {
  title_id: number;
  title_name: string;
  thumbnail_image_url?: string;
  banner_image_url?: string;
  thumbnail_rect_image_url?: string;
}

interface TitleListResponse {
  title_list: TitleDetail[];
}

interface WebTitle {
  title_name: string;
  author_text?: string;
  introduction_text?: string;
  next_updated_text?: string;
  title_in_japanese?: string;
  genre_id_list?: number[];
  episode_id_list: number[];
  thumbnail_image_url?: string;
  thumbnail_rect_image_url?: string;
  banner_image_url?: string;
}

interface DetailResponse {
  web_title: WebTitle;
}

interface GenreDetail {
  genre_name: string;
}

interface GenreListResponse {
  genre_list?: GenreDetail[];
}

interface Episode {
  episode_id: number;
  episode_name: string;
  start_time?: string;
  point: number;
  title_id: number;
  index: number;
  badge: number;
  rental_finish_time?: string;
}

interface EpisodeListResponse {
  episode_list: Episode[];
}

interface ViewerApiResponse {
  page_list: string[];
  scramble_seed: string;
  title_id: number;
  episode_id: number;
}

const CHAPTER_NAME_RE = /(?:chapter|ch|episode|ep|第).?\s*(\d+(?:\.\d+)?)(?:\s*[(（](\d+)[)）])?/i;
const SPLIT_RE = /(\d+(?:\.\d+)?)\s*[(（](\d+)[)）]/;
const FALLBACK_RE = /^(\d+(?:\.\d+)?)(?:\s*[(（](\d+)[)）])?/;
const PART_SUFFIX_RE = /\s*[(（]\d+[)）]/;

export class KmangaScraper extends BaseScraper {
  readonly name = 'K Manga';
  readonly baseUrl = `https://${DOMAIN}`;
  readonly lang = 'en';

  private async hashedGet(urlStr: string): Promise<any> {
    const url = new URL(urlStr);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { params[k] = v; });
    const { value: birthday, expires } = getBirthdayCookie();
    const hash = generateHash(params, birthday, expires);

    const res = await this.get(urlStr, {
      headers: {
        'X-Kmanga-Platform': '3',
        'X-Kmanga-Hash': hash,
        'x-kmanga-client-id': '0',
        'x-kmanga-is-crawler': 'false',
      },
    } as any);
    this.onError(res, url.pathname.includes('viewer'));
    return res.data;
  }

  private onError(res: any, isViewer: boolean): never | void {
    if (res.status === 400) {
      throw new Error(
        isViewer
          ? 'Log in via WebView and rent or purchase this chapter to read.'
          : 'Open WebView and retry',
      );
    }
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const offset = (page - 1) * PAGE_LIMIT;
    const url = `${API_URL}/ranking/all?ranking_id=12&offset=${offset}&limit=${PAGE_LIMIT + 1}`;
    const data = await this.hashedGet(url) as RankingApiResponse;

    if (!data.ranking_title_list?.length) return { mangas: [], hasNextPage: false };

    const titleIds = data.ranking_title_list.map(r => r.id);
    const hasNextPage = titleIds.length > PAGE_LIMIT;
    const mangaIds = hasNextPage ? titleIds.slice(0, PAGE_LIMIT) : titleIds;

    const detailUrl = `${API_URL}/title/list?title_id_list=${mangaIds.join(',')}`;
    const detailData = await this.hashedGet(detailUrl) as TitleListResponse;

    const mangas = detailData.title_list.map(t => ({
      title: t.title_name,
      url: `/title/${t.title_id}`,
      thumbnailUrl: t.thumbnail_image_url || t.banner_image_url || t.thumbnail_rect_image_url || '',
      lang: this.lang,
    }));

    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const data = await this.hashedGet(`${API_URL}/title/weekly`) as LatestResponse;

    const todayList = data.weekly_list.find(w => w.weekday_index === data.today_weekday_index);
    if (!todayList) return { mangas: [], hasNextPage: false };

    const titleById = new Map(data.title_list.map(t => [t.title_id, t]));
    const mangas = todayList.title_id_list
      .map(id => titleById.get(id))
      .filter(Boolean)
      .map(t => ({
        title: t!.title_name,
        url: `/title/${t!.title_id}`,
        thumbnailUrl: t!.thumbnail_image_url || t!.banner_image_url || t!.thumbnail_rect_image_url || '',
        lang: this.lang,
      }));

    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    let url: string;
    if (query.trim()) {
      url = `${API_URL}/search/title?keyword=${encodeURIComponent(query)}&limit=99999`;
    } else {
      url = `${API_URL}/search/title?genre_id=1&limit=99999`;
    }

    const data = await this.hashedGet(url) as TitleListResponse;
    const mangas = data.title_list.map(t => ({
      title: t.title_name,
      url: `/title/${t.title_id}`,
      thumbnailUrl: t.thumbnail_image_url || t.banner_image_url || t.thumbnail_rect_image_url || '',
      lang: this.lang,
    }));

    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const titleId = mangaUrl.replace('/title/', '');
    const url = `${API_URL}/web/title/detail?title_id=${titleId}`;
    const data = await this.hashedGet(url) as DetailResponse;
    const wt = data.web_title;

    let genre: string | undefined;
    if (wt.genre_id_list?.length) {
      const genreUrl = `${API_URL}/genre/list?genre_id_list=${wt.genre_id_list.join(',')}`;
      try {
        const genreData = await this.hashedGet(genreUrl) as GenreListResponse;
        genre = genreData.genre_list?.map(g => g.genre_name).join(', ');
      } catch { }
    }

    const parts: string[] = [];
    if (wt.introduction_text) parts.push(wt.introduction_text);
    if (wt.next_updated_text) parts.push(wt.next_updated_text);
    if (wt.title_in_japanese) parts.push(`Japanese Title: ${wt.title_in_japanese}`);

    return {
      title: wt.title_name,
      url: `/title/${titleId}`,
      thumbnailUrl: wt.thumbnail_image_url || wt.banner_image_url || wt.thumbnail_rect_image_url || '',
      description: parts.length ? parts.join('\n\n') : undefined,
      author: wt.author_text || undefined,
      genre,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const titleId = mangaUrl.replace('/title/', '');
    const url = `${API_URL}/web/title/detail?title_id=${titleId}`;
    const data = await this.hashedGet(url) as DetailResponse;
    const wt = data.web_title;

    if (!wt.episode_id_list.length) return [];

    const episodeIds = wt.episode_id_list.join(',');
    const formBody = `episode_id_list=${encodeURIComponent(episodeIds)}`;

    const { value: birthday, expires } = getBirthdayCookie();
    const params: Record<string, string> = { episode_id_list: episodeIds };
    const hash = generateHash(params, birthday, expires);

    const res = await this.post(
      `${API_URL}/episode/list`,
      formBody,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Kmanga-Platform': '3',
          'X-Kmanga-Hash': hash,
          'x-kmanga-client-id': '0',
          'x-kmanga-is-crawler': 'false',
        },
      } as any,
    );
    this.onError(res, false);

    const epData = res.data as EpisodeListResponse;

    const chapters: Chapter[] = [];
    for (let i = epData.episode_list.length - 1; i >= 0; i--) {
      const ep = epData.episode_list[i];
      const isLocked = ep.point > 0 && ep.badge !== 3 && !ep.rental_finish_time;
      const lock = isLocked ? '[Locked] ' : '';
      let parsedName = ep.episode_name;

      const match = CHAPTER_NAME_RE.exec(parsedName)
        || SPLIT_RE.exec(parsedName)
        || FALLBACK_RE.exec(parsedName);

      let chapterNumber: number | undefined;
      if (match) {
        const main = match[1];
        const part = match[2];
        if (part) {
          const replacement = match[0].replace(PART_SUFFIX_RE, `.${part}`);
          parsedName = parsedName.replace(match[0], replacement);
          chapterNumber = main.includes('.') ? parseFloat(main) : parseFloat(`${main}.${part}`);
        } else {
          chapterNumber = parseFloat(main);
        }
      } else {
        chapterNumber = ep.index;
      }

      if (Number.isNaN(chapterNumber)) chapterNumber = ep.index;

      const dateUpload = ep.start_time ? new Date(ep.start_time + ' UTC').getTime() : undefined;

      chapters.push({
        name: `${lock}${parsedName}`,
        url: `/title/${ep.title_id}/episode/${ep.episode_id}`,
        chapterNumber,
        dateUpload,
      });
    }

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const episodeId = chapterUrl.split('/').pop()!;
    const url = `${API_URL}/web/episode/viewer?episode_id=${episodeId}`;
    const data = await this.hashedGet(url) as ViewerApiResponse;

    return data.page_list.map((pageUrl, index) => ({
      index,
      imageUrl: `${pageUrl}#${data.scramble_seed}:${data.title_id}:${data.episode_id}`,
    }));
  }
}
