import { MadaraScraper } from '../../../engine/madara';

export class FastestMangaScraper extends MadaraScraper {
  constructor() {
    super('Fastest Manga', 'https://www.fastestmanga.com/en', 'en');
  }
}

export default FastestMangaScraper;
