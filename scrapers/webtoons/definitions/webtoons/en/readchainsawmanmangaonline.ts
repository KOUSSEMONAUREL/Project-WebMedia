import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadchainsawmanmangaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Chainsaw Man Manga Online', 'https://ww6.readchainsawman.com', 'en');
  }

  protected override readonly sourceList = [
    { name: 'Chainsaw Man', url: `${this.baseUrl}/manga/chainsaw-man/` },
    { name: '17-21', url: `${this.baseUrl}/manga/17-21-fujimoto-tatsuki-tanpenshuu/` },
    { name: 'Fire Punch', url: `${this.baseUrl}/manga/fire-punch/` },
    { name: 'Nayuta', url: `${this.baseUrl}/manga/yogen-no-nayuta/` },
    { name: 'Look Back', url: `${this.baseUrl}/manga/look-back/` },
    { name: 'Light Novel', url: `${this.baseUrl}/manga/chainsaw-man-buddy-stories/` },
    { name: 'Colored', url: `${this.baseUrl}/manga/chainsaw-man-colored/` },
    { name: 'Listen to Song', url: `${this.baseUrl}/manga/futsuu-ni-kiite-kure/` },
    { name: 'Goodbye, Eri', url: `${this.baseUrl}/manga/sayonara-eri-goodbye-eri/` },
    { name: '22-26', url: `${this.baseUrl}/manga/22-26-fujimoto-tatsuki-tanpenshuu/` },
    { name: 'Chainsaw Man: Buddy Stories', url: `${this.baseUrl}/manga/chainsaw-man-buddy-stories/` },
  ];
}
