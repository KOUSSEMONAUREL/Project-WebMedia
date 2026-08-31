import { MadaraScraper } from '../../../engine/madara';
export class ApcomicsScraper extends MadaraScraper {
  constructor() { super('AP Comics', 'https://apcomics.org', 'en'); }
  protected override readonly useNewChapterEndpoint = true;
}
