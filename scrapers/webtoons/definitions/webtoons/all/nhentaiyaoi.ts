import { MadaraScraper } from '../../../engine/madara';

export class NhentaiYaoiScraper extends MadaraScraper {
  constructor() {
    super('nHentai Yaoi', 'https://nhentaiyaoi.com', 'all');
  }
}

export default NhentaiYaoiScraper;
