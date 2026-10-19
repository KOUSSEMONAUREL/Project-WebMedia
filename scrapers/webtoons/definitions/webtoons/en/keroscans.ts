import { VineThemeScraper } from '../../../engine/vinetheme';

export class KeroscansScraper extends VineThemeScraper {
  constructor() {
    super('Keroscans', 'https://keroscans.net', 'en');
  }
}
