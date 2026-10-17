import { YiiMadaraScraper } from '../../../engine/yiimadara';
import type { SearchResult } from '../../../engine/types';

export class Manga18fxScraper extends YiiMadaraScraper {
  constructor() {
    super('Manga18fx', 'https://manga18fx.com', 'all');
  }

  protected override readonly directoryPath: string | null = null;
  protected override readonly completedPath: string | null = null;
  protected override readonly rawPath: string | null = 'manhwa-raw';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/hot-manga`);
    url.searchParams.set('page', String(page));
    const response = await this.get(url.toString());
    return this.mangaListParse(response.data as string);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const response = await this.get(this.listUrl('page', page));
    return this.mangaListParse(response.data as string);
  }
}
