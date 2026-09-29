import { KemonoScraper } from '../../../engine/kemono';
export class CoomerScraper extends KemonoScraper {
  protected override readonly serviceTypes: string[] = [
    'OnlyFans',
    'Fansly',
    'CandFans',
  ];
  constructor() { super('Coomer', 'https://coomer.st', 'all'); }
}
