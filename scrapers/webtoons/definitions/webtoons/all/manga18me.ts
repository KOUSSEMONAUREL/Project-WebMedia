import { YiiMadaraScraper } from '../../../engine/yiimadara';

export class Manga18MeScraper extends YiiMadaraScraper {
  constructor() {
    super('Manga18.me', 'https://manga18.me', 'all');
  }

  protected override readonly rawPath: string | null = 'manhwa-raw';
}
