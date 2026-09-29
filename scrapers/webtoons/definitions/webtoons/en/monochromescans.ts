import { MonochromeCMSScraper } from '../../../engine/monochrome';

export class MonochromescansScraper extends MonochromeCMSScraper {
  constructor() {
    super('Monochrome Scans', 'https://manga.d34d.one', 'en');
  }
}
