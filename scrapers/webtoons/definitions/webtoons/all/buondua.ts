import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class BuonDuaScraper extends BaseScraper {
  readonly name = 'Buon Dua';
  readonly baseUrl = 'https://buondua.com';
  readonly lang = 'all';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    let url: string;
    if (query) {
      url = `/?search=${encodeURIComponent(query)}&start=${20 * (page - 1)}`;
    } else {
      url = `/hot?start=${20 * (page - 1)}`;
    }
    const res = await this.get(url);
    return this._parseMangasPage(res.data);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/hot?start=${20 * (page - 1)}`);
    return this._parseMangasPage(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/?start=${20 * (page - 1)}`);
    return this._parseMangasPage(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const titleEl = $('.article-header').first();
    const titlePageRegex = / - \( Page \d+ \/ \d+ \)/;

    const articleInfo = $('.article-info > strong').text()
      .replace('Buondua', '')
      .trim();

    const password = $('code').first().text();
    const downloadLinks = [...$('.article-links a[href]')]
      .map(el => {
        const service = $(el).text();
        const link = $(el).attr('href') || '';
        return `[${service}](${link})`;
      })
      .join('\n');

    const descParts: string[] = [];
    if (articleInfo) descParts.push(articleInfo);
    if (downloadLinks) descParts.push(downloadLinks);
    if (password) descParts.push(password);
    const description = descParts.join('\n\n');

    const manga: Partial<Manga> = {
      title: titleEl.text().replace(titlePageRegex, '').trim(),
      url: mangaUrl,
      description,
      lang: this.lang,
    };

    return manga;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);

    const lastNext = $('nav.pagination:first-of-type a.pagination-next').last();
    let maxPage = 1;
    if (lastNext.length > 0) {
      const href = lastNext.attr('href') || '';
      if (href.startsWith('http')) {
        try {
          const pageParam = new URL(href).searchParams.get('page');
          if (pageParam) maxPage = parseInt(pageParam, 10);
        } catch (err) {
          console.error(`Failed to parse page URL on ${this.name}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    const chapters: Chapter[] = [];
    for (let page = maxPage; page >= 1; page--) {
      const url = new URL(mangaUrl);
      url.searchParams.set('page', String(page));
      chapters.push({
        name: `Page ${page}`,
        url: url.toString(),
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('.article-fulltext img').map((i: number, el: any) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    })).get();
  }

  private _parseMangasPage(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.blog > div').map((_i: number, el: any) => {
      const link = $(el).find('.item-content .item-link').first();
      if (link.length === 0) return null;
      const img = $(el).find('img').first();
      return {
        title: link.text(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      };
    }).get().filter((m): m is Manga => m !== null);

    const hasNextPage = $('.pagination-next:not([disabled])').length > 0;
    return { mangas, hasNextPage };
  }
}
