import { KemonoScraper } from '../../../engine/kemono';
export class KemonoCrScraper extends KemonoScraper {
  protected override readonly serviceTypes: string[] = [
    'Patreon',
    'Pixiv Fanbox',
    'Discord',
    'Fantia',
    'Afdian',
    'Boosty',
    'Gumroad',
    'SubscribeStar',
  ];
  constructor() { super('Kemono', 'https://kemono.cr', 'all'); }
}
