import { MadaraScraper } from '../../../engine/madara';

export class LgbticsScraper extends MadaraScraper {
  constructor() {
    super('Lgbtics', 'https://lgbtics.com', 'en');
  }

  protected override readonly mangaSubString = 'comic';
}

export default LgbticsScraper;
