import { IkenScraper } from '../../../engine/iken';
export class MagusmangaScraper extends IkenScraper {
  constructor() { super('Magus Manga', 'https://magustoon.org', 'en', 'https://api.magustoon.org'); }
  protected override readonly sortPagesByFilename = true;
}
