import { MadaraScraper } from '../../../engine/madara';

// Transcompilation of keiyoushi src/en/jinmangas (Jinmangas.kt): stock
// Madara theme, `chapterMode = ChapterMode.MangaAjax` (chapters via the
// `<manga>/ajax/chapters` endpoint — our engine's `useNewChapterEndpoint`).
// Upstream #404 moved the source from `jinmangas.com` to `mangafree.info`.
export class JinmangasScraper extends MadaraScraper {
  constructor() {
    super('Jinmangas', 'https://mangafree.info', 'en');
  }

  protected override readonly useNewChapterEndpoint = true;
}
