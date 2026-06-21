import { IkenScraper } from '../../../engine/iken';
export class SanascansScraper extends IkenScraper {
  constructor() { super('Sana Scans', 'https://sanascans.com', 'en', 'https://api.sanascans.com'); }
  protected override readonly perPage = 30;
  protected override readonly sortPagesByFilename = true;
}
