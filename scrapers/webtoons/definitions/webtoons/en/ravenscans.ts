import { MangaThemesiaScraper } from '../../../engine/mangathemesia';

export class RavenscansScraper extends MangaThemesiaScraper {
  constructor() {
    super('Raven Scans', 'https://ravenscans.org', 'en', '/manga');
  }
}
