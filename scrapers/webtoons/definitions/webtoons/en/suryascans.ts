import { KeyoappScraper } from '../../../engine/keyoapp';
import type { SearchResult } from '../../../engine/types';

export class SuryascansScraper extends KeyoappScraper {
  constructor() { super('Genz Toons', 'https://genztoons.org', 'en'); }

  async getPopular(_page = 1): Promise<SearchResult> {
    return this.getSearch('', 1);
  }
}
