import { YiiMadaraScraper } from '../../../engine/yiimadara';

export class Manhwa18ccScraper extends YiiMadaraScraper {
  constructor() {
    super('Manhwa18.cc', 'https://manhwa18.cc', 'all');
  }

  protected override readonly mangaPath: string = 'webtoon';
  protected override readonly rawPath: string | null = 'raw';
  protected override readonly directoryPath: string | null = 'webtoons';
}
