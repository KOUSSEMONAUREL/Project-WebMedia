import { MadaraScraper } from '../../../engine/madara';
export class ManhwadenScraper extends MadaraScraper {
  constructor() { super('ManhwaDen', 'https://www.manhwaden.com', 'en'); }
  protected override readonly filterNonMangaItems = false;
}
