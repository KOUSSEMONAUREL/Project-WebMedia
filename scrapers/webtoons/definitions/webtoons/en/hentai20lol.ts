import { YiimangaScraper } from '../../../engine/yiimanga';
export class Hentai20lolScraper extends YiimangaScraper {
  constructor() { super('Hentai20 (Unoriginal)', 'https://hentai20.lol'); }
  protected override readonly mangaPath = 'manga';
  protected override readonly popularPath: string | null = 'manga-lists';
}
