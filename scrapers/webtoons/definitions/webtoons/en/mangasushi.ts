import { MadaraScraper } from '../../../engine/madara';
export class MangasushiScraper extends MadaraScraper {
  constructor() { super('MangaSushi', 'https://mangasushi.org', 'en'); }
}
