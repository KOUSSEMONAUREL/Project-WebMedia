import { MangaThemesiaScraper } from '../../../engine/mangathemesia';

// Upstream keiyoushi #404 moved Madara Scans to https://madarascans.net and
// dropped every custom override (custom search/details/chapter selectors,
// datePattern, pageSelector): the site is back on the stock MangaThemesia
// layout, so this port follows it with no overrides.
export class MadarascansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Madara Scans', 'https://madarascans.net', 'en', '/series');
  }
}
