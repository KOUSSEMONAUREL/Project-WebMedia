import { MadaraScraper } from '../../../engine/madara';
export class TopmanhuaScraper extends MadaraScraper {
  constructor() { super('Top Manhua', 'https://mangatop.org', 'en', 'MM/dd/yy'); }
  protected override readonly filterNonMangaItems = false;
  protected override readonly mangaSubString = 'series';
}
