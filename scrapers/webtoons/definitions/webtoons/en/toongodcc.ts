import { YiimangaScraper } from '../../../engine/yiimanga';
export class ToongodccScraper extends YiimangaScraper {
  constructor() { super('ToonGod (Unoriginal)', 'https://toongod.cc'); }
  protected override readonly mangaPath = 'webtoon';
  protected override readonly popularPath: string | null = 'webtoons';
}
