import { KomikoEngine } from '../../../engine/komiko';

export class KomikoScraper extends KomikoEngine {
  constructor() {
    super('Komiko', 'https://www.komiko.io', 'fr');
  }
}

export default KomikoScraper;
