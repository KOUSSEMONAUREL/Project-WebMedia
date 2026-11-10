import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const TITLE_PREFIX = /^(?:porn comics 3d|porno-comics 3d|porn comic|porno comic|comic porno)\s+/i;

export class WPornComicsScraper extends BaseScraper {
  override readonly name = 'W Porn Comics';
  override readonly baseUrl = 'https://wporncomics.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl('', page, 'views'));
    return this.parseListing(res.data);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(this.listUrl('', page));
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.listUrl('search', page, 'views'));
    url.searchParams.set('q', query.trim());
    const res = await this.get(url.toString());
    return this.parseListing(res.data);
  }

  private listUrl(path: string, page: number, sort?: string): string {
    const url = new URL(`${this.baseUrl}/${path ? `${path}/` : ''}`);
    if (sort) url.searchParams.set('sort', sort);
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('#ul-comix-set > li').each((_, el) => {
      const item = $(el);
      const link = item.children('h2.block-name-comix-set').children('a').first();
      const href = link.attr('href');
      const title = link.text().trim();
      if (!href || !title) return;
      const thumb = item.find('.block-images-comix-set img').first().attr('data-src') || '';
      mangas.push({
        title: title.replace(TITLE_PREFIX, ''),
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb),
        lang: this.lang,
      });
    });
    const hasNextPage = $('a.pstr_next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const heading = $('h1.block-name-comix').first().text().trim();
    const info = $('#foot-block-comix-category');
    const thumbnailUrl = $('.block-images-comix img').first().attr('data-src') || '';
    const author = info
      .find('a[href*=/studios/]')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join(', ');
    const genre = [...info.find('a[href*=/categories/]').toArray(), ...info.find('a[href*=/tag_page/]').toArray()]
      .map(el => $(el).text().trim())
      .filter((value, index, all) => value && all.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index)
      .join(', ');
    const rawDescription = $('#block-comix-grid .mini-description').first().text().trim();
    const titleIndex = rawDescription.indexOf(heading);
    const description = (titleIndex >= 0 ? rawDescription.slice(titleIndex + heading.length) : rawDescription).trim();
    return {
      title: heading.replace(TITLE_PREFIX, ''),
      url: mangaUrl,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      author: author || undefined,
      genre: genre || undefined,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const dateText = $('ul.comix-info > li')
      .filter((_, el) => $(el).text().includes('Date:'))
      .find('i')
      .first()
      .text()
      .trim();
    const time = Date.parse(dateText);
    return [{
      name: 'Chapter',
      url: mangaUrl,
      dateUpload: Number.isNaN(time) ? undefined : time,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('#block-image-slide a[rel=group] > img[data-src]')
      .filter((_, el) => $(el).attr('alt') !== 'Premium')
      .each((_, el) => {
        const src = $(el).attr('data-src');
        if (!src) return;
        pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
      });
    return pages;
  }
}
