import { MadaraScraper } from '../../../engine/madara';
import type { Chapter, Page } from '../../../engine/types';

export class KaliscanorgScraper extends MadaraScraper {
  constructor() {
    super('KaliScan.org', 'https://kaliscan.org', 'en');
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    return [];
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    return [];
  }
}
