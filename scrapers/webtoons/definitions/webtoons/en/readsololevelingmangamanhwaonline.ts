import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadsololevelingmangamanhwaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Solo Leveling Manga Manhwa Online', 'https://ww4.readsololeveling.org', 'en');
  }

  protected override readonly sourceList = [
    { name: 'Solo Leveling Manhwa', url: `${this.baseUrl}/manga/solo-leveling/` },
    { name: 'Solo Leveling Light Novel', url: `${this.baseUrl}/manga/solo-leveling-light-novel/` },
    { name: 'Solo Leveling : Ragnarok', url: `${this.baseUrl}/manga/solo-leveling-ragnarok/` },
    { name: 'SL: Ragnarok Novel', url: `${this.baseUrl}/manga/solo-leveling-ragnarok-novel/` },
  ];
}