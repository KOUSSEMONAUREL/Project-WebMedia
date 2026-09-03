import { MadaraScraper } from '../../../engine/madara';
export class MangamaniacsScraper extends MadaraScraper {
  constructor() { super('MangaManiacs', 'https://mangamaniacs.org', 'en'); }
}
