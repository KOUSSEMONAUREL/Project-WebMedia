import { YiimangaScraper } from '../../../engine/yiimanga';
export class ManhwagalaxyScraper extends YiimangaScraper {
  constructor() { super('ManhwaGalaxy', 'https://manhwagalaxy.com'); }
  protected override readonly mangaPath = 'manhwa';
  protected override readonly searchParam = 'q';
}
