import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class Readnanatsunotaizai7deadlysinsmangaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Nanatsu no Taizai 7 Deadly Sins Manga Online', 'https://ww8.read7deadlysins.com', 'en');
    this.sourceList = [
      { name: 'Four Horsemen of the Apocalypse', url: `${this.baseUrl}/manga/four-horsemen-of-the-apocalypse/` },
      { name: '7DS: School', url: `${this.baseUrl}/manga/mayoe-nanatsu-no-taizai-gakuen/` },
      { name: '7DS:7 Days', url: `${this.baseUrl}/manga/nanatsu-no-taizai-seven-days/` },
      { name: '7DS:Vampires', url: `${this.baseUrl}/manga/nanatsu-no-taizai-vampires-of-edinburgh/` },
      { name: 'Queen of Altar', url: `${this.baseUrl}/manga/the-queen-of-the-altar/` },
      { name: '7DS: 7 Colors', url: `${this.baseUrl}/manga/nanatsu-no-taizai-nanairo-no-tsuioku/` },
      { name: '7DS x FT', url: `${this.baseUrl}/manga/fairy-tail-x-nanatsu-no-taizai-christmas-special/` },
      { name: 'Kongou Banchou', url: `${this.baseUrl}/manga/kongou-banchou/` },
      { name: '7DS:7 Scars', url: `${this.baseUrl}/manga/nanatsu-no-taizai-the-seven-scars-which-they-left-behind/` },
      { name: '7 Deadly Sins', url: `${this.baseUrl}/manga/nanatsu-no-taizai/` },
      { name: 'Mokushiroku no Yonkishi', url: `${this.baseUrl}/manga/four-horsemen-of-the-apocalypse/` },
    ];
  }
}