import { MadaraScraper } from '../../../engine/madara';
export class CoffeemangaScraper extends MadaraScraper {
  constructor() { super('Coffee Manga', 'https://coffeemanga.io', 'en'); }
  protected override readonly useLoadMoreRequest = 'Never';
  protected override readonly useNewChapterEndpoint = true;
}
