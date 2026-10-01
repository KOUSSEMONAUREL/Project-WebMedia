import { MadaraScraper } from '../../../engine/madara';

export class ManhwahubtoScraper extends MadaraScraper {
  constructor() { super('ManhwaHub.to', 'https://manhwahub.to', 'en'); }
  protected override readonly mangaSubString = 'manhwa';
}
