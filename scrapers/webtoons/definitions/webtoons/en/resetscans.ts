import { MadaraScraper } from '../../../engine/madara';
export class ResetscansScraper extends MadaraScraper {
  constructor() { super('Reset Scans', 'https://reset-scans.org', 'en', 'dd-MMM'); }
  protected override readonly useNewChapterEndpoint = true;
  protected override readonly popularMangaSelectorStr = '.rs-manga-library__card';
  protected override readonly popularMangaUrlSelector = '.rs-manga-library__card-title a';
  protected override readonly searchMangaSelectorStr = '.rs-manga-library__card';
  protected override readonly searchMangaUrlSelector = '.rs-manga-library__card-title a';
  protected override readonly chapterListSelectorStr = 'li.wp-manga-chapter:not(:has(a[href*=\'#\']))';
}
