import { MadaraScraper } from '../../../engine/madara';

export class NovelCoolScraper extends MadaraScraper {
  constructor() {
    super('NovelCool', 'https://www.novelcool.com', 'en', 'MMM dd, yyyy');
  }
}
