import { MadaraScraper } from '../../../engine/madara';
export class MangafreeScraper extends MadaraScraper {
  constructor() { super('MangaFree', 'https://mangafree.info', 'en'); }
}
