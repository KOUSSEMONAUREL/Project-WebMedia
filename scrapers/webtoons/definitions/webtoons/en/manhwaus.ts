import { YiiMadaraScraper } from '../../../engine/yiimadara';

export class ManhwausScraper extends YiiMadaraScraper {
  constructor() {
    super('ManhwaUS', 'https://manhwaus.net', 'en');
  }

  protected override readonly mangaPath: string = 'webtoon';
  protected override readonly directoryPath: string | null = 'webtoons';
  protected override readonly pageSegment: boolean = true;
  protected override readonly trailingSlash: boolean = true;
  protected override readonly searchParam: string = 's';
  protected override readonly rawPath: string | null = 'raw';
}
