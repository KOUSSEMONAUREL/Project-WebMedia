import { YiimangaScraper } from '../../../engine/yiimanga';
export class ManhwaddictScraper extends YiimangaScraper {
  constructor() { super('Manhwaddict', 'https://manhwaddict.com'); }
  protected override readonly mangaPath = 'manga';
  protected override readonly searchParam = 'q';
}
