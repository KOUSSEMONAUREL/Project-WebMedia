import { MadaraScraper } from '../../../engine/madara';

export class ZazamangaScraper extends MadaraScraper {
  protected override readonly mangaSubString = 'manga';
  protected override readonly filterNonMangaItems = false;
  protected override readonly useLoadMoreRequest = 'Never';
  protected override readonly searchMangaSelectorStr = 'div.page-item-detail, div.c-tabs-item__content';
  protected override readonly mangaDetailsSelectorTitle = 'h1.post-title';
  protected override readonly mangaDetailsSelectorGenre = 'div.post-content div.tags a';
  protected override readonly chapterListSelectorStr = 'div.wp-manga-chapter' as unknown as 'li.wp-manga-chapter';

  constructor() {
    super('Zazamanga', 'https://www.zazamanga.com', 'en');
  }

  protected override popularMangaNextPageSelector(): string {
    return 'ul.pagination > li:last-child:not(.disabled) > a[href]';
  }
}

export default ZazamangaScraper;
