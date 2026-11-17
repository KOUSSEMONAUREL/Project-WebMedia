import { KomikoEngine } from '../../../engine/komiko';

export class HotMangaScraper extends KomikoEngine {
  constructor() {
    super('Hot Manga', 'https://www.hot-manga.fr', 'fr', {
      apiUrl: 'https://api.hot-manga.fr/v1',
      productPath: 'produit',
      // Every volume has a preview, ebook or not
      ebookOnly: false,
    });
  }
}

export default HotMangaScraper;
