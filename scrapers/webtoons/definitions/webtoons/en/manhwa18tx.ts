import { YiimangaScraper } from '../../../engine/yiimanga';
export class Manhwa18txScraper extends YiimangaScraper {
  constructor() { super('Manhwa18TX', 'https://manhwa18tx.com'); }
  protected override readonly mangaPath = 'manhwa';
  protected override readonly searchParam = 'q';
}
