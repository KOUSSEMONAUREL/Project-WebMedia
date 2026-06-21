import { MadaraScraper } from '../../../engine/madara';

export class AquaMangaScraper extends MadaraScraper {
  constructor() {
    super('Aqua Manga', 'https://aquareader.org', 'en');
  }

  protected override readonly useLoadMoreRequest = 'Never';
}
