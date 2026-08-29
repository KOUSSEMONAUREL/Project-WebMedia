import { VineThemeScraper } from '../../../engine/vinetheme';

export class KaynscansScraper extends VineThemeScraper {
  constructor() {
    super('Kayn Scans', 'https://kaynscans.com', 'en');
  }
}