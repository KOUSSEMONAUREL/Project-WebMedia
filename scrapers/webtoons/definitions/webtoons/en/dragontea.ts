import { MadaraScraper } from '../../../engine/madara';
export class DragonteaScraper extends MadaraScraper {
  constructor() { super('Dragon Tea', 'https://dragontea.xyz', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
