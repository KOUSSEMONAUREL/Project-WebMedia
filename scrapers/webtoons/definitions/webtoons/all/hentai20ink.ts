import { MadaraScraper } from '../../../engine/madara';
export class Hentai20inkScraper extends MadaraScraper {
  constructor() {
    super('Hentai20.ink (unoriginal)', 'https://www.hentai20.ink', 'all', 'MMM d, yyyy');
  }
  protected override readonly useNewChapterEndpoint = true;
}
