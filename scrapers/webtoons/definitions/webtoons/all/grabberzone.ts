import { MadaraScraper } from '../../../engine/madara';
export class GrabberzoneScraper extends MadaraScraper {
  constructor() { super('Grabber Zone', 'https://grabber.zone', 'all', 'dd.MM.yyyy'); }
  protected override readonly mangaSubString = 'comics';
}
