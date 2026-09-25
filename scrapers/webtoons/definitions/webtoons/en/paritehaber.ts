import { MadaraScraper } from '../../../engine/madara';
export class ParitehaberScraper extends MadaraScraper {
  constructor() { super('Paritehaber', 'https://www.paritehaber.com', 'en'); }
}
