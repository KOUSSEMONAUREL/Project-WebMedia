import { MadaraScraper } from '../../../engine/madara';
export class MangadistrictScraper extends MadaraScraper {
  constructor() { super('Manga District', 'https://mangadistrict.com', 'en'); }
  protected override readonly mangaSubString = 'series';
  protected override searchMangaSelectorStr = "div.c-tabs-item__content , .manga__item , div.page-item-detail.manga";
  protected override popularMangaNextPageSelector(): string | null { return '.wp-pagenavi a.last'; }
  protected override searchMangaNextPageSelector(): string | null { return '.wp-pagenavi a.last'; }
}
