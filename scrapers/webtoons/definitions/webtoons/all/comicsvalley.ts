import { MadaraScraper } from '../../../engine/madara';
export class ComicsvalleyScraper extends MadaraScraper {
  constructor() { super('Comics Valley', 'https://comicsvalley.com', 'all', 'dd/MM/yyyy'); }
  protected override readonly mangaSubString = 'comics-new';
}
