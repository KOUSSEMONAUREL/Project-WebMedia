import { MadaraScraper } from '../../../engine/madara';
export class ManhwareadsScraper extends MadaraScraper {
  constructor() { super('Manhwa Reads', 'https://manhwareads.com', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
