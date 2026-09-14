import { MadaraScraper } from '../../../engine/madara';

export class ZinmanganetScraper extends MadaraScraper {
  constructor() {
    super('Zinmanga.net', 'https://www.zinmanga.net', 'en', 'MM/dd/yyyy');
  }

  protected override readonly filterNonMangaItems = false;
  protected override readonly useNewChapterEndpoint = true;
}
