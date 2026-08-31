import { MadaraScraper } from '../../../engine/madara';
export class ManhwanexScraper extends MadaraScraper {
  constructor() { super('ManhwaNex', 'https://manhwanex.com', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
