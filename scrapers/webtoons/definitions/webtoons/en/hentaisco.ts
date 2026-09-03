import { MadaraScraper } from '../../../engine/madara';
export class HentaiscoScraper extends MadaraScraper {
  constructor() { super('HentaiSco', 'https://hentaisco.cc', 'en', 'MMMM dd, yyyy'); }
  protected override readonly mangaSubString = 'hentai';
}
