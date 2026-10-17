import { YiiMadaraScraper } from '../../../engine/yiimadara';

export class Readmanga18Scraper extends YiiMadaraScraper {
  constructor() {
    super('ReadManga18', 'https://readmanga18.com', 'en');
  }

  protected override readonly trailingSlash: boolean = true;
  protected override readonly searchParam: string = 's';
  protected override readonly completedPath: string | null = null;
  protected override readonly rawPath: string | null = 'raw';
}
