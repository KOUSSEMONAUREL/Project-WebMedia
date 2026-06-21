import { MadaraScraper } from '../../../engine/madara';
export class LilymangaScraper extends MadaraScraper {
  constructor() { super('Lily Manga', 'https://lilymanga.net', 'en', 'dd.MM.yyyy'); }
  protected override readonly mangaSubString = 'ys';
  protected override readonly useNewChapterEndpoint = true;
  protected override readonly useLoadMoreRequest = 'Never';
}
