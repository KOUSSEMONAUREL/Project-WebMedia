import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadkingdommangaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Kingdom Manga Online', 'https://ww6.readkingdom.com', 'en');
  }

  protected override readonly sourceList = [
    { name: 'Kingdom', url: `${this.baseUrl}/manga/kingdom/` },
    { name: 'Li Mu', url: `${this.baseUrl}/manga/li-mu/` },
    { name: 'Meng Wu & Chu Zi', url: `${this.baseUrl}/manga/meng-wu-and-chu-zi-one-shot/` },
  ];
}
