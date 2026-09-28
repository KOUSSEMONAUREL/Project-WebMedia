import { LilianaScraper } from '../../../engine/liliana';

// Transcompilation of keiyoushi src/en/manhuaplusorg (Liliana theme, no overrides).
export class ManhuaplusorgScraper extends LilianaScraper {
  constructor() {
    super('ManhuaPlus (Unoriginal)', 'https://manhuaplus.org', 'en');
  }
}
