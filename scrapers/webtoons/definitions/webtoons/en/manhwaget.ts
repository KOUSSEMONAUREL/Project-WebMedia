import { MadaraScraper } from '../../../engine/madara';
export class ManhwagetScraper extends MadaraScraper {
  constructor() { super('ManhwaGet', 'https://manhwaget.com', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
