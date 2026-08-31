import { MadaraScraper } from '../../../engine/madara';
export class GalaxydegenscansScraper extends MadaraScraper {
  constructor() { super('GalaxyDegenScans', 'https://gdscans.com', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
