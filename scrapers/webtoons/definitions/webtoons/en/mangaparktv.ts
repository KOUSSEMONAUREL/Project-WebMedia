import { MadaraScraper } from '../../../engine/madara';
export class MangaparktvScraper extends MadaraScraper {
  constructor() { super('MangaPark.tv (unoriginal)', 'https://mangapark.tv', 'en'); }
  // Upstream `chapterMode = ChapterMode.MangaAjax`: chapters come from the
  // `<mangaUrl>/ajax/chapters` endpoint, not the classic admin-ajax one.
  protected override readonly useNewChapterEndpoint = true;
}
