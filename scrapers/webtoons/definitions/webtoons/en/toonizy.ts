import { MadaraScraper } from '../../../engine/madara';
export class ToonizyScraper extends MadaraScraper {
  constructor() { super('Toonizy', 'https://toonizy.com', 'en', 'MMM d, yy'); }
  protected override readonly mangaSubString = 'webtoon';
  protected override readonly mangaDetailsSelectorTitle = '.post-content h3';
  protected override readonly useNewChapterEndpoint = true;
}
