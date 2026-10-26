import { MadaraScraper } from '../../../engine/madara';

/**
 * Transcompilation of keiyoushi `en/rubycomics` (Madara theme, MangaAjax
 * chapter mode). Series pages expose their chapter list through
 * `admin-ajax.php?action=manga_get_chapters`, which the shared Madara engine
 * already handles.
 */
export class RubyComicsScraper extends MadaraScraper {
  protected override readonly mangaDetailsSelectorDescription =
    'div.description-summary div.limit-html';

  constructor() {
    super('Ruby Comics', 'https://rubycomics.net', 'en');
  }

  protected override processThumbnail(url: string | null): string | null {
    return url ? url.replace(/-\d+x\d+(\.[a-zA-Z]+)$/, '$1') : null;
  }
}

export default RubyComicsScraper;
