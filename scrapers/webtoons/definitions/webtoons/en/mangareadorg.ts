import { MadaraScraper } from '../../../engine/madara';
export class MangareadorgScraper extends MadaraScraper {
  constructor() { super('MangaRead', 'https://www.mangaread.org', 'en'); }
}
