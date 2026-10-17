import { YiiMadaraScraper } from '../../../engine/yiimadara';

export class MangaDNAScraper extends YiiMadaraScraper {
  constructor() {
    super('MangaDNA', 'https://mangadna.com', 'all');
  }

  protected override readonly completedPath: string | null = null;
  protected override readonly rawPath: string | null = 'manhwa-raw';

  protected override listUrl(path: string, page: number): string {
    if (path === this.directoryPath) {
      return `${this.baseUrl}/${path}/page/${page}`.replace(/([^:])\/+/g, '$1/');
    }
    return super.listUrl(path, page);
  }
}
