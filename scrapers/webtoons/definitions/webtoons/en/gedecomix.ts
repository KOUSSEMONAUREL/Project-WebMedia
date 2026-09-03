import { MadaraScraper } from '../../../engine/madara';
export class GedecomixScraper extends MadaraScraper {
  constructor() { super('GEDEComix', 'https://gedecomix.com', 'en'); }
  protected override readonly mangaSubString = 'porncomic';
}
