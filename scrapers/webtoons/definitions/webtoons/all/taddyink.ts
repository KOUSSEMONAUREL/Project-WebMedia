import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface Comic {
  identifier?: string;
  name: string;
  url: string;
  description?: string;
  genres?: string[];
  creators?: Array<{ identifier?: string; name?: string }>;
  coverImage?: { base_url?: string; cover_sm?: string };
  issues?: ChapterData[];
}

interface ComicResults {
  status: string;
  comicseries: Comic[];
}

interface ChapterData {
  identifier: string;
  name: string;
  datePublished: string;
  stories?: Array<{ storyImage?: { base_url?: string; story?: string } }>;
}

const dateFormatter = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})Z?/;

function parseDate(s: string): number {
  const m = dateFormatter.exec(s);
  if (m) return new Date(m[1]).getTime();
  return 0;
}

function getManga(comic: Comic): Manga {
  const thumbnailBaseUrl = comic.coverImage?.base_url || '';
  const thumbnail = comic.coverImage?.cover_sm || '';
  const thumbnailUrl = thumbnailBaseUrl && thumbnail ? `${thumbnailBaseUrl}${thumbnail}` : '';
  const genre = comic.genres?.map(g => genreMap[g]).filter(Boolean).join(', ') || '';
  const author = comic.creators?.map(c => c.name).filter(Boolean).join(', ') || undefined;
  return {
    title: comic.name,
    url: comic.url,
    thumbnailUrl,
    lang: 'all',
    author: author || undefined,
    description: comic.description || undefined,
    genre: genre || undefined,
  };
}

const genrePairs: Array<[string, string]> = [
  ['', ''],
  ['Action', 'COMICSERIES_ACTION'],
  ['Comedy', 'COMICSERIES_COMEDY'],
  ['Drama', 'COMICSERIES_DRAMA'],
  ['Educational', 'COMICSERIES_EDUCATIONAL'],
  ['Fantasy', 'COMICSERIES_FANTASY'],
  ['Historical', 'COMICSERIES_HISTORICAL'],
  ['Horror', 'COMICSERIES_HORROR'],
  ['Inspirational', 'COMICSERIES_INSPIRATIONAL'],
  ['Mystery', 'COMICSERIES_MYSTERY'],
  ['Romance', 'COMICSERIES_ROMANCE'],
  ['Sci-Fi', 'COMICSERIES_SCI_FI'],
  ['Slice Of Life', 'COMICSERIES_SLICE_OF_LIFE'],
  ['Superhero', 'COMICSERIES_SUPERHERO'],
  ['Supernatural', 'COMICSERIES_SUPERNATURAL'],
  ['Wholesome', 'COMICSERIES_WHOLESOME'],
  ['BL (Boy Love)', 'COMICSERIES_BL'],
  ['GL (Girl Love)', 'COMICSERIES_GL'],
  ['LGBTQ+', 'COMICSERIES_LGBTQ'],
  ['Thriller', 'COMICSERIES_THRILLER'],
  ['Zombies', 'COMICSERIES_ZOMBIES'],
  ['Post Apocalyptic', 'COMICSERIES_POST_APOCALYPTIC'],
  ['School', 'COMICSERIES_SCHOOL'],
  ['Sports', 'COMICSERIES_SPORTS'],
  ['Animals', 'COMICSERIES_ANIMALS'],
  ['Gaming', 'COMICSERIES_GAMING'],
];

const genreMap: Record<string, string> = {};
for (const [label, value] of genrePairs) {
  genreMap[value] = label;
}

export class TaddyInkScraper extends BaseScraper {
  readonly name = 'Taddy INK (Webtoons)';
  readonly lang = 'all';
  readonly baseUrl = 'https://taddy.org';
  private taddyLang = '';
  private displayFullTitle = true;

  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/feeds/directory/list?lang=${this.taddyLang}&taddyType=comicseries&ua=tc&page=${page}&limit=25`;
    const res = await this.get(url);
    const result: ComicResults = res.data;
    const mangas = result.comicseries.map(c => getManga(c));
    return { mangas, hasNextPage: result.comicseries.length === 25 };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      const parsedUrl = new URL(query);
      const baseHost = new URL(this.baseUrl).host;
      if (parsedUrl.host !== baseHost) throw new Error('Unsupported url');
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (!segments[0]) throw new Error('Unsupported url');
      const details = await this.getMangaDetails(query);
      if (!details.title) return { mangas: [], hasNextPage: false };
      return { mangas: [{ title: details.title, url: query, thumbnailUrl: details.thumbnailUrl || '', lang: this.lang }], hasNextPage: false };
    }
    const url = `${this.baseUrl}/feeds/directory/search?q=${encodeURIComponent(query)}&lang=${this.taddyLang}&taddyType=comicseries&ua=tc&page=${page}&limit=25`;
    const res = await this.get(url);
    const result: ComicResults = res.data;
    const mangas = result.comicseries.map(c => getManga(c));
    return { mangas, hasNextPage: result.comicseries.length === 25 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const comic: Comic = res.data;
    return getManga(comic);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const comic: Comic = res.data;
    const baseUrl = comic.url;
    const chapters = (comic.issues || []).map((ch, i, arr) => ({
      name: ch.name,
      url: `${baseUrl}#${ch.identifier}`,
      dateUpload: parseDate(ch.datePublished) || undefined,
      chapterNumber: arr.length - i,
    }));
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const issueUuid = chapterUrl.split('#').pop() || '';
    const baseChapterUrl = chapterUrl.split('#')[0];
    const res = await this.get(baseChapterUrl);
    const comic: Comic = res.data;
    const issue = (comic.issues || []).find(ch => ch.identifier === issueUuid);
    if (!issue) return [];
    return (issue.stories || []).map((story, index) => ({
      index,
      imageUrl: `${story.storyImage?.base_url || ''}${story.storyImage?.story || ''}`,
    }));
  }
}
