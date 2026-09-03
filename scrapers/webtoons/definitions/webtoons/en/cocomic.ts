import { MadaraScraper } from '../../../engine/madara';
export class CocomicScraper extends MadaraScraper {
  constructor() { super('Cocomic', 'https://cocomic.co', 'en'); }
}
