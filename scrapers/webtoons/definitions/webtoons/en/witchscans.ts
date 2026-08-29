import { VineThemeScraper } from '../../../engine/vinetheme';

export class WitchscansScraper extends VineThemeScraper {
  constructor() {
    super('Witch Scans', 'https://witchtoons.net', 'en');
  }
}