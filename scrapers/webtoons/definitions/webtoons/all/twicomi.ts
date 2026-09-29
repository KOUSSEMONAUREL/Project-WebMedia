import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://api.twicomi.com/api/v2';
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const AUTHOR_SEARCH_PREFIX = 'author:';

interface TwicomiResponse<T> {
  response: T;
}

interface MangaListWithCount {
  total_count: number;
  manga_list: MangaListItem[];
}

interface MangaListItem {
  author: AuthorDto;
  tweet: TweetDto;
}

interface AuthorListWithCount {
  total_count: number;
  author_list: AuthorWrapperDto[];
}

interface AuthorWrapperDto {
  author: AuthorDto;
}

interface AuthorDto {
  screen_name: string;
  name: string;
  description?: string | null;
  profile_image?: string | null;
}

interface TweetDto {
  tweet_id: string;
  tweet_text: string;
  attach_image_urls: string[];
  tags: string[];
  hash_tags: string[];
  tweet_create_time: string;
}

function parseTokyoDateTime(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) - TOKYO_OFFSET_MS;
}

export class TwicomiScraper extends BaseScraper {
  readonly name = 'Twicomi';
  readonly baseUrl = 'https://twicomi.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getMangaList(`${API_URL}/manga/featured/list?page_no=${page}&page_limit=24`);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getMangaList(`${API_URL}/manga/list?order_by=create_time&page_no=${page}&page_limit=24`);
  }

  private async getMangaList(url: string): Promise<SearchResult> {
    const response = await this.get(url);
    const data = response.data as TwicomiResponse<MangaListWithCount>;
    const parsed = new URL(url);
    const currentPage = Number(parsed.searchParams.get('page_no') || '1');
    const pageLimit = Number(parsed.searchParams.get('page_limit') || '10');
    const mangas = data.response.manga_list.map(item => this.mangaFromTweet(item));
    return { mangas, hasNextPage: currentPage * pageLimit < data.response.total_count };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith(AUTHOR_SEARCH_PREFIX)) {
      const authorQuery = query.slice(AUTHOR_SEARCH_PREFIX.length);
      const url = new URL(`${API_URL}/author/list`);
      if (authorQuery.trim() !== '') {
        url.searchParams.set('query', authorQuery);
      }
      url.searchParams.set('order_by', 'follower_count');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('page_no', String(page));
      url.searchParams.set('page_limit', '12');
      const response = await this.get(url.toString());
      const data = response.data as TwicomiResponse<AuthorListWithCount>;
      const mangas = data.response.author_list.map(entry => this.mangaFromAuthor(entry.author));
      return { mangas, hasNextPage: page * 12 < data.response.total_count };
    }

    const url = new URL(`${API_URL}/manga/list`);
    if (query.trim() !== '') {
      url.searchParams.set('query', query);
    }
    url.searchParams.set('order_by', 'create_time');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('page_no', String(page));
    url.searchParams.set('page_limit', '12');
    return this.getMangaList(url.toString());
  }

  private mangaFromTweet(item: MangaListItem): Manga {
    const tweetAuthor = item.author;
    const timestamp = parseTokyoDateTime(item.tweet.tweet_create_time) ?? 0;
    const extraData = `${timestamp},${item.tweet.attach_image_urls.join(', ')}`;
    return {
      url: `/manga/${tweetAuthor.screen_name}/${item.tweet.tweet_id}#${extraData}`,
      title: item.tweet.tweet_text.split('\n')[0],
      thumbnailUrl: item.tweet.attach_image_urls[0] ?? '',
      lang: this.lang,
      author: `${tweetAuthor.name} (@${tweetAuthor.screen_name})`,
      description: item.tweet.tweet_text,
      genre: [...item.tweet.hash_tags, ...item.tweet.tags].join(', ') || undefined,
      status: 2,
    };
  }

  private mangaFromAuthor(author: AuthorDto): Manga {
    return {
      url: `/author/${author.screen_name}`,
      title: author.name,
      thumbnailUrl: author.profile_image ?? '',
      lang: this.lang,
      author: author.screen_name,
      description: author.description ?? undefined,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const parts = mangaUrl.split('/');
    if (parts[1] === 'author') {
      return this.getAuthorChapterList(parts[2]);
    }
    if (parts[1] === 'manga') {
      const hashIndex = mangaUrl.indexOf('#');
      const timestamp = Number(mangaUrl.slice(hashIndex + 1).split(',')[0]);
      return [{
        url: mangaUrl,
        name: 'Tweet',
        dateUpload: Number.isNaN(timestamp) ? undefined : timestamp,
      }];
    }
    throw new Error(`Twicomi: unsupported url ${mangaUrl}`);
  }

  private async getAuthorChapterList(screenName: string): Promise<Chapter[]> {
    const pageLimit = 500;
    const results: MangaListItem[] = [];
    let page = 0;
    let totalCount = 0;
    do {
      page += 1;
      const url =
        `${API_URL}/author/manga/list?screen_name=${encodeURIComponent(screenName)}` +
        `&order_by=create_time&order=asc&page_no=${page}&page_limit=${pageLimit}`;
      const response = await this.get(url);
      const data = response.data as TwicomiResponse<MangaListWithCount>;
      results.push(...data.response.manga_list);
      totalCount = data.response.total_count;
    } while (page * pageLimit < totalCount);

    return results
      .map((item, i) => {
        const manga = this.mangaFromTweet(item);
        const hashIndex = manga.url.indexOf('#');
        const timestamp = Number(manga.url.slice(hashIndex + 1).split(',')[0]);
        return {
          url: manga.url,
          name: item.tweet.tweet_text.split('\n')[0],
          chapterNumber: i + 1,
          dateUpload: Number.isNaN(timestamp) ? undefined : timestamp,
        } as Chapter;
      })
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const hashIndex = chapterUrl.indexOf('#');
    if (hashIndex < 0) return [];
    const urls = chapterUrl.slice(hashIndex + 1).split(',').slice(1).map(s => s.trim()).filter(Boolean);
    return urls.map((imageUrl, i) => ({ index: i, imageUrl }));
  }
}
