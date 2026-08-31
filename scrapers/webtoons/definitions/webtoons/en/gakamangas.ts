import { MadaraScraper } from '../../../engine/madara';
export class GakamangasScraper extends MadaraScraper {
  constructor() { super('GakaMangas', 'https://gakamangas.com', 'en'); }
  protected override readonly filterNonMangaItems = false;
  protected override readonly useNewChapterEndpoint = true;
}
