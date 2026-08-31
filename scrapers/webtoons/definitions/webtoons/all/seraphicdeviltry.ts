import { MadaraScraper } from '../../../engine/madara';
export class SeraphicdeviltryScraper extends MadaraScraper {
  constructor() { super('SeraphicDeviltry', 'https://seraphic-deviltry.com', 'all', 'MM/dd/yyyy'); }
  protected override readonly useNewChapterEndpoint = true;
}
