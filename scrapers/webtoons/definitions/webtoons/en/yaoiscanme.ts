import { YiimangaScraper } from '../../../engine/yiimanga';
export class YaoiscanmeScraper extends YiimangaScraper {
  constructor() { super('YaoiScan (Unoriginal)', 'https://yaoiscan.me'); }
  protected override readonly mangaPath = 'read';
  protected override readonly searchParam = 'q';
}
