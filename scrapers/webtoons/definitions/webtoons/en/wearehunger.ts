import { MadaraScraper } from '../../../engine/madara';
export class WearehungerScraper extends MadaraScraper {
  constructor() { super('We Are Hunger', 'https://kokomangas.com', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
