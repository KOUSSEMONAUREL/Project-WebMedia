import { IkenScraper } from '../../../engine/iken';
export class KaynscansScraper extends IkenScraper {
  constructor() { super('Kayn Scans', 'https://kaynscan.org', 'en', 'https://api.kaynscan.org'); }
}
