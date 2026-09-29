import { EroMuseScraper } from '../../../engine/eromuse';

export class EightmusesScraper extends EroMuseScraper {
  constructor() {
    super('8Muses', 'https://comics.8muses.com', 'en');
  }
}
