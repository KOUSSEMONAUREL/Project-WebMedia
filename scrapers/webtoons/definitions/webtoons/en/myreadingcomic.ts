import { YiimangaScraper } from '../../../engine/yiimanga';
export class MyreadingcomicScraper extends YiimangaScraper {
  constructor() { super('MyReadingComic', 'https://myreadingcomic.com'); }
  protected override readonly mangaPath = 'comic';
  protected override readonly searchParam = 'q';
  protected override readonly popularPath: string | null = 'porn-comics';
}
