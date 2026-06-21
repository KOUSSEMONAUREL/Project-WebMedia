import { MadaraScraper } from '../../../engine/madara';
export class FirescansScraper extends MadaraScraper {
  constructor() { super('Firescans', 'https://firescans.xyz', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
