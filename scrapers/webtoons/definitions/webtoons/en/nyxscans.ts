import { IkenScraper } from '../../../engine/iken';
export class NyxscansScraper extends IkenScraper {
  constructor() { super('Nyx Scans', 'https://nyxscans.com', 'en', 'https://api.nyxscans.com'); }
}
