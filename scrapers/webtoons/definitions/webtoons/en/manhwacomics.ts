import { MadaraScraper } from '../../../engine/madara';
export class ManhwacomicsScraper extends MadaraScraper {
  constructor() { super('ManhwaComics', 'https://manhwacomics.com', 'en', 'd MMM yyyy'); }
  protected override readonly mangaSubString = 'manhwa';
  protected override readonly useNewChapterEndpoint = true;
}
