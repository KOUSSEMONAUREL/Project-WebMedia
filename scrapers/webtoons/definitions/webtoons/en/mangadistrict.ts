import { MadaraScraper } from '../../../engine/madara';
export class MangadistrictScraper extends MadaraScraper {
  constructor() { super('Manga District', 'https://mangadistrict.com', 'en'); }
  protected override readonly mangaSubString = 'series';
}
