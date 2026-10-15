import { YiimangaScraper } from '../../../engine/yiimanga';
export class ManhwaonlineScraper extends YiimangaScraper {
  constructor() { super('ManhwaOnline', 'https://manhwaonline.org'); }
  protected override readonly mangaPath = 'manga';
  protected override readonly popularPath: string | null = 'webtoons';
}
