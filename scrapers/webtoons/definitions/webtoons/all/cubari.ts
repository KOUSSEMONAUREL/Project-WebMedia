import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const AUTHOR_FALLBACK = 'Unknown';
const ARTIST_FALLBACK = 'Unknown';
const DESCRIPTION_FALLBACK = 'No description.';
const SEARCH_FALLBACK_MSG = 'Please enter a valid Cubari URL';

const volumeNotSpecifiedTerms = new Set(['Uncategorized', 'null', '']);

export class CubariScraper extends BaseScraper {
  readonly name = 'Cubari';
  readonly baseUrl = 'https://cubari.moe';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/`);
    const result = response.data;
    return this.parseMangaList(result, 'PINNED');
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    if (query.startsWith('https://') || query.startsWith('cubari:')) {
      const [source, slug] = this.deepLinkHandler(query);
      const response = await this.get(`${this.baseUrl}/read/api/${source}/series/${slug}/`);
      const result = response.data;
      const manga = this.parseManga(result, { url: `/read/${source}/${slug}` });
      return { mangas: [manga], hasNextPage: false };
    }

    const response = await this.get(`${this.baseUrl}/`);
    const result = response.data;
    const arr = Array.isArray(result) ? result : [];
    const filtered = arr.filter((item: any) =>
      (item.title || '').toString().toLowerCase().includes(query.trim().toLowerCase()),
    );
    return this.parseMangaList(filtered, 'ALL');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const urlComponents = mangaUrl.split('/');
    const source = urlComponents[2];
    const slug = urlComponents[3];
    const response = await this.get(`${this.baseUrl}/read/api/${source}/series/${slug}/`);
    const result = response.data;
    return this.parseChapterList(result, mangaUrl);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    if (chapterUrl.includes('/chapter/')) {
      const response = await this.get(`${this.baseUrl}${chapterUrl}`);
      const pages = response.data;
      return (pages as any[]).map((jsonEl: any, i: number) => ({
        index: i,
        imageUrl: jsonEl.src || jsonEl,
      }));
    }

    const urlParts = chapterUrl.split('/');
    const source = urlParts[2];
    const slug = urlParts[3];
    const response = await this.get(`${this.baseUrl}/read/api/${source}/series/${slug}/`);
    const jsonObj = response.data;
    return this.seriesJsonPageListParse(jsonObj, chapterUrl);
  }

  private seriesJsonPageListParse(jsonObj: any, chapterUrl: string): Page[] {
    const chapterNum = chapterUrl.split('/').filter(Boolean).pop() || '';
    const groups = jsonObj.groups || {};
    const groupMap: Record<string, string> = {};
    for (const [key, val] of Object.entries(groups)) {
      groupMap[(val as string) || 'default'] = key;
    }

    const chapters = jsonObj.chapters || {};
    const chapterKey = chapters[chapterNum]
      ? chapterNum
      : parseInt(chapterNum, 10).toString();

    const chapterEntry = chapters[chapterKey];
    if (!chapterEntry) return [];

    const pages = chapterEntry.groups?.[Object.values(groupMap)[0] || '1'] || [];
    return (pages as any[]).map((jsonEl: any, i: number) => ({
      index: i,
      imageUrl: jsonEl.src || jsonEl,
    }));
  }

  private deepLinkHandler(query: string): [string, string] {
    if (query.startsWith('cubari:')) {
      const frags = query.replace('cubari:', '').split('/').slice(0, 2);
      return [frags[0], frags[1]];
    }
    const url = new URL(query);
    const host = url.host;
    const pathSegments = url.pathname.split('/').filter(Boolean);

    if (host.endsWith('imgur.com') && pathSegments.length >= 2 && ['a', 'gallery'].includes(pathSegments[0])) {
      return ['imgur', pathSegments[1]];
    }
    if (host.endsWith('reddit.com') && pathSegments.length >= 2 && pathSegments[0] === 'gallery') {
      return ['reddit', pathSegments[1]];
    }
    if (host === 'imgchest.com' && pathSegments.length >= 2 && pathSegments[0] === 'p') {
      return ['imgchest', pathSegments[1]];
    }
    if (host.endsWith('catbox.moe') && pathSegments.length >= 2 && pathSegments[0] === 'c') {
      return ['catbox', pathSegments[1]];
    }
    if (host.endsWith('cubari.moe') && pathSegments.length >= 3) {
      return [pathSegments[1], pathSegments[2]];
    }
    if (host.endsWith('.githubusercontent.com')) {
      const src = host.split('.')[0];
      const path = url.pathname;
      const b64 = Buffer.from(`${src}${path}`).toString('base64').replace(/=+$/, '');
      return ['gist', b64];
    }
    throw new Error(SEARCH_FALLBACK_MSG);
  }

  private parseChapterList(jsonObj: any, mangaUrl: string): Chapter[] {
    const groups = jsonObj.groups || {};
    const chapters = jsonObj.chapters || {};
    const chapterList: Chapter[] = [];

    for (const [chapterNum, chapterObj] of Object.entries(chapters)) {
      const chObj = chapterObj as any;
      const chapterGroups = chObj.groups || {};
      const volume = chObj.volume;
      const volumeStr = volumeNotSpecifiedTerms.has(volume?.toString() || '') ? null : volume?.toString();
      const title = chObj.title || '';

      for (const [groupNum] of Object.entries(chapterGroups)) {
        const releaseDate = chObj.release_date?.[groupNum];
        const scanlator = groups[groupNum] || '';
        const name = [
          volumeStr ? `Vol.${volumeStr} ` : '',
          `Ch.${chapterNum}`,
          title ? ` - ${title}` : '',
        ].join('');

        let url = '';
        if (Array.isArray(chapterGroups[groupNum])) {
          url = `${mangaUrl}/${chapterNum}/${groupNum}`;
        } else {
          url = chapterGroups[groupNum] || '';
        }

        chapterList.push({
          url,
          name,
          chapter_number: parseFloat(chapterNum) || -1,
          date_upload: releaseDate ? Math.floor(parseFloat(releaseDate) * 1000) : 0,
          scanlator,
        });
      }
    }

    return chapterList.sort((a, b) => (b.chapter_number || 0) - (a.chapter_number || 0));
  }

  private parseMangaList(payload: any[], sortType: 'PINNED' | 'UNPINNED' | 'ALL'): SearchResult {
    const mangas: Manga[] = [];
    for (const item of payload) {
      const pinned = item.pinned;
      if (sortType === 'PINNED' && pinned) mangas.push(this.parseManga(item));
      else if (sortType === 'UNPINNED' && !pinned) mangas.push(this.parseManga(item));
      else if (sortType === 'ALL') mangas.push(this.parseManga(item));
    }
    return { mangas, hasNextPage: false };
  }

  private parseManga(jsonObj: any, mangaReference?: { url: string }): Manga {
    const descriptionFull = jsonObj.description || '';
    const description = descriptionFull ? descriptionFull.split('Tags: ')[0] : DESCRIPTION_FALLBACK;
    const genre = descriptionFull?.includes('Tags: ') ? descriptionFull.split('Tags: ')[1] : '';
    return {
      title: jsonObj.title || '',
      artist: jsonObj.artist || ARTIST_FALLBACK,
      author: jsonObj.author || AUTHOR_FALLBACK,
      description: description?.trim() || DESCRIPTION_FALLBACK,
      genre: genre || '',
      url: mangaReference?.url || jsonObj.url || '',
      thumbnail_url: jsonObj.coverUrl || jsonObj.cover || '',
    };
  }
}
