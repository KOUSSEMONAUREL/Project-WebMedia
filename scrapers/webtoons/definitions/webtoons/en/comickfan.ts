import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';
import type { CheerioAPI } from 'cheerio';

interface ChapterListItem {
  id: number;
  hash_id: string;
  chapter: string;
  title: string | null;
  volume: string | null;
  language: string;
  published_at: string | null;
  group_names: string[];
  created_at: string | null;
  updated_at: string | null;
}

interface ChapterListResponse {
  data: ChapterListItem[];
}

export class ComicKFanScraper extends BaseScraper {
  readonly name = 'ComicK Fanmade';
  readonly baseUrl = 'https://comickfan.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchManga('', page, 'rating');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchManga('', page, 'latest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.searchManga(query, page, '');
  }

  private async searchManga(query: string, page: number, sort: string): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/advanced-search`, {
      params: { genres: '', status: '', type: '', sort, name: query, page: String(page) },
    });
    const $ = this.$(res.data);
    const mangas = $('div:has(> form) + div.grid > a').toArray().map(el => {
      const $el = $(el);
      const img = $el.find('img').first();
      return {
        title: img.attr('alt') || '',
        url: $el.attr('href') || '',
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      };
    });
    const hasNextPage = $('a:has(img[alt=Next])').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const infoRoot = $('div.bg-card-section');
    const title = $('h1').first().text().trim();
    const description = $('div.comic-content.desk').text().trim() || undefined;
    const thumbnailUrl = this.absUrl(infoRoot.find('div.thumb-cover img').first().attr('src') || '');
    const author = this.getValue(infoRoot, 'Author', $)?.split(',').join(', ') || undefined;
    const artist = this.getValue(infoRoot, 'Artist', $)?.split(',').join(', ') || undefined;
    const genre = infoRoot.find('div.font-medium:contains(Genres) + div a').toArray().map(el => $(el).text().trim()).join(', ') || undefined;
    const statusText = this.getValue(infoRoot, 'Status', $)?.toLowerCase() || '';
    let status: MangaStatus;
    if (statusText === 'ongoing') status = 1;
    else if (statusText === 'completed') status = 0;
    else if (statusText === 'hiatus') status = 3;
    return { title, url: mangaUrl, thumbnailUrl, description, author, artist, genre, status, lang: this.lang };
  }

  private getValue(root: ReturnType<CheerioAPI>, label: string, $: CheerioAPI): string | null {
    const row = root.find('div.flex-row.gap-4').filter((_i, e) => {
      return $(e).find('> div.text-sm').first().text().trim() === label;
    }).first();
    const el = row.find('> div.text-sm:nth-child(2):last-child').first();
    const text = el.text().trim();
    if (!text || text === '-' || text === '_') return null;
    return text;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.replace(this.baseUrl, '').replace('/manga/', '').split('/')[0];
    const res = await this.get(`${this.baseUrl}/api/comics/${slug}/chapter-list`, {
      params: { translation_group_id: '' },
    });
    const body = res.data as ChapterListResponse;
    return (body.data || []).map(ch => ({
      name: `Chapter ${ch.chapter}`,
      url: `/manga/${slug}/chapter-${ch.chapter}-${ch.hash_id}`,
      chapterNumber: parseFloat(ch.chapter) || undefined,
      dateUpload: ch.created_at ? new Date(ch.created_at).getTime() : undefined,
    }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${this.baseUrl}${chapterUrl}`);
    const $ = this.$(res.data);
    const images = $('div.w-full > img[loading=lazy]').toArray();
    return images.map((el, idx) => ({
      index: idx,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}
