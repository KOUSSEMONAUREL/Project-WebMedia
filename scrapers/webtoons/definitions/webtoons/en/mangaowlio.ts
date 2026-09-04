import { MadaraScraper } from '../../../engine/madara';
export class MangaowlioScraper extends MadaraScraper {
  constructor() { super('MangaOwl.io', 'https://mangaowl.io', 'en'); }
  protected override readonly mangaSubString = 'read-1';
}
