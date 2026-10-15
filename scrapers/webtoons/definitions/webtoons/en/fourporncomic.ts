import { YiimangaScraper } from '../../../engine/yiimanga';
export class FourporncomicScraper extends YiimangaScraper {
  constructor() { super('4PornComic', 'https://4porncomic.com'); }
  protected override readonly mangaPath = 'comic';
  protected override readonly searchParam = 'q';
  protected override readonly popularPath: string | null = 'porn-comics';
}
