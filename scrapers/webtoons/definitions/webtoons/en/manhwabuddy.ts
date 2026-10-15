import { YiimangaScraper } from '../../../engine/yiimanga';
import type { SearchResult } from '../../../engine/types';

export class ManhwabuddyScraper extends YiimangaScraper {
  constructor() { super('ManhwaBuddy', 'https://manhwabuddy.com'); }
  protected override readonly mangaPath = 'manhwa';

  // Upstream override: popular is the `.item-move` rail on the homepage,
  // not the paginated list.
  override async getPopular(): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data as string);
    const mangas = $('.item-move').toArray().map((element) => {
      const $el = $(element);
      const link = $el.find('.name a').first();
      return {
        title: link.text().trim(),
        url: this.toPath(link.attr('href') ?? ''),
        thumbnailUrl: this.absUrl($el.find('img').first().attr('src') ?? ''),
        lang: this.lang,
      };
    }).filter((m) => m.title && m.url);
    return { mangas, hasNextPage: false };
  }
}
