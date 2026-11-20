import { MadaraScraper } from '../../../engine/madara';
import type { Manga, SearchResult } from '../../../engine/types';

export class TopmanhuafanScraper extends MadaraScraper {
  constructor() {
    super('Top Manhua Fan', 'https://www.topmanhua.fan', 'en');
  }

  protected override readonly searchMangaSelectorStr =
    'div.page-item-detail.manga, div.c-tabs-item__content, .manga__item';

  protected override readonly chapterListSelectorStr =
    'div.wp-manga-chapter, li.wp-manga-chapter';

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (/^https?:\/\//.test(query)) {
      const parsed = new URL(query);
      if (parsed.host.replace(/^www\./, '') !== 'topmanhua.fan') {
        throw new Error('Unsupported url');
      }
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 2) {
        throw new Error('Unsupported url');
      }
      const mangaUrl = `${this.baseUrl}/manhua/${segments[1]}/`;
      const mangaData = await this.getMangaDetails(mangaUrl);
      const manga: Manga = {
        title: mangaData.title || segments[1],
        url: mangaUrl,
        thumbnailUrl: mangaData.thumbnailUrl || '',
        lang: this.lang,
        author: mangaData.author,
        description: mangaData.description,
      };
      return { mangas: [manga], hasNextPage: false };
    }
    return super.getSearch(query, page);
  }
}
