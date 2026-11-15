import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const SPANISH_CATEGORY_ID = '2217';

export class FreeAdultComixScraper extends BaseScraper {
  override readonly name = 'Free Adult Comix';
  override readonly baseUrl = 'https://freeadultcomix.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl(page));
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    let result = await this.search(trimmed, page);
    if (result.mangas.length === 0 && trimmed !== '') {
      const normalized = this.normalizeQuery(trimmed);
      if (normalized !== '' && normalized !== trimmed) {
        result = await this.search(normalized, page);
      }
    }
    return result;
  }

  private async search(query: string, page: number): Promise<SearchResult> {
    const url = new URL(this.listUrl(page));
    if (query !== '') url.searchParams.set('s', query);
    const res = await this.get(url.toString());
    return this.parseListing(res.data);
  }

  private normalizeQuery(query: string): string {
    return query
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private listUrl(page: number): string {
    const path = page > 1 ? `/page/${page}/` : '/';
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('cat', `-${SPANISH_CATEGORY_ID}`);
    return url.toString();
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('ul.videos > li').each((_, el) => {
      const item = $(el);
      const link = item.find('a.titulo').first();
      const href = link.attr('href');
      const title = link.text().trim();
      if (!href || !title) return;
      const thumb = item.find('img').first().attr('src') || '';
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb),
        lang: this.lang,
      });
    });
    const hasNextPage = $('ul.paginacao li.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.post-conteudo h1').first().text().trim();
    const thumbnailUrl = this.pageUrls($)[0] ?? '';
    const genre = $('.post-tags a')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join(', ');
    const description = $('.post-texto > :not(.dgwt-jg-gallery)')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(text => text && text !== title)
      .join('\n\n');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      genre: genre || undefined,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    if (this.pageUrls($).length === 0) return [];
    return [{ name: 'Chapter', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return this.pageUrls($).map((imageUrl, index) => ({ index, imageUrl }));
  }

  private pageUrls($: ReturnType<BaseScraper['$']>): string[] {
    const gallery = $('.dgwt-jg-gallery figure > a[href], .fotos .foto > a[href]')
      .toArray()
      .map(el => $(el).attr('href') ?? '')
      .filter(Boolean)
      .map(href => this.absUrl(href));

    if (gallery.length > 0) return gallery;

    return $('.post-texto img')
      .toArray()
      .map(el => this.originalImageUrl($(el)))
      .filter(Boolean);
  }

  private originalImageUrl(image: Cheerio<Element>): string {
    const srcset = image.attr('srcset') ?? '';
    const best = srcset
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => {
        const [url, size] = entry.split(/\s+/);
        return { url: url ?? '', width: Number.parseInt((size ?? '').replace(/w$/, ''), 10) || 0 };
      })
      .sort((a, b) => b.width - a.width)[0];
    return best?.url ? this.absUrl(best.url) : this.absUrl(image.attr('src') ?? '');
  }
}
