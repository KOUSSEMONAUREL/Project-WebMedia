import { MadaraScraper } from '../../../engine/madara';

export class TopManhuaFanScraper extends MadaraScraper {
  protected readonly mangaSubString = 'manhua';
  protected readonly useLoadMoreRequest = 'Never';
  protected readonly chapterListSelectorStr = 'div.wp-manga-chapter';

  constructor() {
    super('TopManhuaFan', 'https://www.topmanhua.fan', 'en', 'MM/dd/yyyy');
  }
}
