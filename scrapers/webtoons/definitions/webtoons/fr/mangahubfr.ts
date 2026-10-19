import { MadaraScraper } from '../../../engine/madara';

export class MangahubfrScraper extends MadaraScraper {
  constructor() {
    super('MangaHub FR', 'https://mangahub.fr', 'fr');
  }

  protected override readonly useNewChapterEndpoint = true;
}
