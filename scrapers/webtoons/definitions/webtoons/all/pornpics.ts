import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const QUERY_PAGE_SIZE = 19;

interface MangaDto {
  desc: string;
  g_url: string;
  t_url: string;
}

function slugToTitle(url: string): string {
  const slug = url.replace(/\/$/, '').split('/').pop() ?? '';
  const parts = slug.split('-').filter(p => p.length > 0 && !/^\d+$/.test(p));
  if (parts.length === 0) return slug;
  const joined = parts.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export class PornPicsScraper extends BaseScraper {
  readonly name = 'PornPics';
  readonly baseUrl = 'https://www.pornpics.com';
  readonly lang = 'all';

  private readonly mangaSelector = '#main li.thumbwook > a.rel-link';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${this.baseUrl}/popular/api/galleries/list/?limit=${QUERY_PAGE_SIZE + 1}&offset=${(page - 1) * QUERY_PAGE_SIZE}&period=1&category_id=2586&lang=en`,
      { headers: { Cookie: 'pp_lang=' } },
    );
    return this.parseMangasPage(res);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${this.baseUrl}/popular/api/galleries/list/?limit=${QUERY_PAGE_SIZE + 1}&offset=${(page - 1) * QUERY_PAGE_SIZE}&period=2&category_id=2587&lang=en`,
      { headers: { Cookie: 'pp_lang=' } },
    );
    return this.parseMangasPage(res);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) {
      return this.getPopular(page);
    }
    const res = await this.get(
      `${this.baseUrl}/search/srch.php?lang=en&offset=${(page - 1) * QUERY_PAGE_SIZE}&limit=${QUERY_PAGE_SIZE + 1}&q=${encodeURIComponent(query)}`,
      { headers: { Cookie: 'pp_lang=' } },
    );
    return this.parseMangasPage(res);
  }

  private parseMangasPage(response: any): SearchResult {
    const url: string = response.config?.url || response.request?.path || '';
    const isSearch = url.includes('q=');
    const isDefault = url.includes('period=');
    const offset = parseInt(url.match(/offset=(\d+)/)?.[1] || '0', 10);
    const responseAsJson = isSearch || isDefault || offset > 0;

    let mangas: Manga[];
    if (responseAsJson) {
      const data: MangaDto[] = response.data;
      mangas = data.map(item => ({
        url: item.g_url.replace('https://www.pornpics.com', ''),
        title: item.desc && item.desc.trim() ? item.desc : slugToTitle(item.g_url),
        thumbnailUrl: item.t_url,
        lang: this.lang,
      }));
    } else {
      const $ = this.$(response.data);
      mangas = $(this.mangaSelector).map((_: any, el: any) => {
        const imgEl = $(el).find('img').first();
        return {
          url: $(el).attr('href') || '',
          title: imgEl.attr('alt') || '',
          thumbnailUrl: imgEl.attr('data-src') || imgEl.attr('src') || '',
          lang: this.lang,
        };
      }).get();
    }
    const hasNextPage = mangas.length > QUERY_PAGE_SIZE;
    if (hasNextPage) mangas = mangas.slice(0, -1);
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const imgEl = $(this.mangaSelector).find('img').first();
    const title = $('.gallery-title h1').first().text().trim() || imgEl.attr('alt') || '';
    const thumbnailUrl = imgEl.attr('data-src') || imgEl.attr('src') || '';
    const infoEl = $('div.gallery-info.to-gall-info');
    const author = infoEl.find('div.gallery-info__item:nth-child(2) a').toArray()
      .map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined;
    const genre = infoEl.find('div.gallery-info__item:not(:nth-child(2)) a').toArray()
      .map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined;
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, author, genre };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{
      name: 'Chapter',
      url: mangaUrl,
      chapterNumber: 0,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $(this.mangaSelector).map((index: number, el: any) => ({
      index,
      imageUrl: $(el).attr('href') || '',
    })).get();
  }
}
