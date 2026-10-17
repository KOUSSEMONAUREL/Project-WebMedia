import { YiiMadaraScraper } from '../../../engine/yiimadara';

export class MangaDassScraper extends YiiMadaraScraper {
  constructor() {
    super('MangaDass', 'https://mangadass.com', 'en');
  }

  protected override readonly rawPath: string | null = 'raw-manhwa';
  protected override readonly rawEntries = 'show';
}
