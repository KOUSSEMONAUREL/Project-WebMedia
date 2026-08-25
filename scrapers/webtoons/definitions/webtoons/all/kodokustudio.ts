import { MadaraScraper } from '../../../engine/madara';
export class KodokustudioScraper extends MadaraScraper {
  constructor() { super('Kodoku Studio', 'https://kodokustudio.com', 'all'); }
  protected override readonly mangaSubString = 'manhua';
}
