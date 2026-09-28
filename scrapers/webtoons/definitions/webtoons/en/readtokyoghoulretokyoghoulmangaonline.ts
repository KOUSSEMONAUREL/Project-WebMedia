import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadtokyoghoulretokyoghoulmangaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Tokyo Ghoul Re Tokyo Ghoul Manga Online', 'https://ww12.tokyoghoulre.com', 'en');
  }

  protected override readonly sourceList = [
    { name: 'Tokyo Ghoul', url: `${this.baseUrl}/manga/tokyo-ghoul/` },
    { name: 'Tokyo Ghoul Jack', url: `${this.baseUrl}/manga/tokyo-ghoul-jack/` },
    { name: 'Tokyo Ghoul: re Colored', url: `${this.baseUrl}/manga/tokyo-ghoulre-colored/` },
    { name: 'Gorilla', url: `${this.baseUrl}/manga/this-gorilla-will-die-in-1-day/` },
    { name: 'Zakki', url: `${this.baseUrl}/manga/tokyo-ghoul-zakki/` },
    { name: 'Light Novel', url: `${this.baseUrl}/manga/tokyo-ghoul-re-light-novels/` },
    { name: 'Choujin X', url: `${this.baseUrl}/manga/choujin-x/` },
    { name: 'Tokyo Ghoul re', url: `${this.baseUrl}/manga/tokyo-ghoulre/` },
  ];
}
