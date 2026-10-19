import { MadaraScraper } from '../../../engine/madara';

export class LovesjanescansScraper extends MadaraScraper {
  constructor() {
    super('Loves Jane Scans', 'https://lovesjane.site', 'en');
  }

  protected override readonly useNewChapterEndpoint = true;
}
