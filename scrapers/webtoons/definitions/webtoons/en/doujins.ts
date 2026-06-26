import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class DoujinsScraper extends BaseScraper {
  readonly name = 'Doujins';
  readonly baseUrl = 'https://doujins.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/top/month`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('div:not(.premium-folder) > .thumbnail-doujin a.gallery-visited-from-favorites').toArray().map(el => {
      const $el = $(el);
      const url = this.absUrl($el.attr('href') || '');
      const title = $el.find('div.title .text').text();
      const imgUrl = $el.find('img').attr('srcset') || $el.find('img').attr('src') || '';
      const thumbnailUrl = this.absUrl(imgUrl);
      const artist = $el.parent()?.next()?.find('.single-line strong').last()?.text()?.replace('Artist: ', '') || '';
      return { title, url, thumbnailUrl, artist: artist || undefined, lang: this.lang };
    });
    const pagination = $('.pagination').first();
    const hasNextPage = pagination.length > 0 && !pagination.find('li.page-item:last-child').hasClass('disabled');
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('.folder-title a').last().text();
    const artist = $('.gallery-artist a').toArray().map(el => $(el).text()).join(', ');
    const genre = $('.tag-area').first().find('a').toArray().map(el => $(el).text()).join(', ');
    return { title, url: mangaUrl, author: artist || undefined, genre: genre || undefined, lang: this.lang };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const scanlator = $('div.folder-message:contains(Translated)').text().split('by:').pop()?.trim();
    const dateText = $('.text-md-right.text-sm-left > .folder-message').first().text().split(' • ')[0];
    const dateUpload = dateText ? new Date(dateText).getTime() || undefined : undefined;
    return [{
      name: 'Chapter',
      url: mangaUrl,
      scanlator: scanlator || undefined,
      dateUpload,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('.doujin').toArray().map((el, index) => {
      const $el = $(el);
      const dataLink = $el.attr('data-link') || '';
      return {
        index,
        imageUrl: this.absUrl(`${chapterUrl}${dataLink}`),
      };
    });
  }
}
