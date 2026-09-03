import { MadaraScraper } from '../../../engine/madara';
export class MangacrazyScraper extends MadaraScraper {
  constructor() { super('MangaCrazy', 'https://mangacrazy.net', 'all'); }
}
