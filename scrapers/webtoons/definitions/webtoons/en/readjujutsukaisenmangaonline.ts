import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadjujutsukaisenmangaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Jujutsu Kaisen Manga Online', 'https://ww6.readjujutsukaisen.com', 'en');
  }

  protected override readonly sourceList = [
    { name: 'Jujutsu Kaisen', url: `${this.baseUrl}/manga/jujutsu-kaisen/` },
    { name: 'Jujutsu Kaisen 0', url: `${this.baseUrl}/manga/jujutsu-kaisen-0/` },
    { name: 'JJK Colored', url: `${this.baseUrl}/manga/jujutsu-kaisen-colored/` },
    { name: 'Fan Scan', url: `${this.baseUrl}/manga/jujutsu-kaisen-fan-scan/` },
    { name: 'JJK Light Novel', url: `${this.baseUrl}/manga/jujutsu-kaisen-first-light-novel/` },
    { name: '2nd Light Novel', url: `${this.baseUrl}/manga/jujutsu-kaisen-second-light-novel/` },
    { name: 'No.9', url: `${this.baseUrl}/manga/no-9/` },
    { name: 'Fanbook', url: `${this.baseUrl}/manga/jujutsu-kaisen-official-fanbook/` },
  ];
}
