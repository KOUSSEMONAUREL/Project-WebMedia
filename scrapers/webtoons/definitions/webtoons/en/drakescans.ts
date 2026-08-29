import { VineThemeScraper } from '../../../engine/vinetheme';

export class DrakescansScraper extends VineThemeScraper {
  constructor() {
    super('Drake Scans', 'https://drakecomic.net', 'en');
  }
}