import { MadaraScraper } from '../../../engine/madara';
import type { Chapter } from '../../../engine/types';

export class CocomicScraper extends MadaraScraper {
  constructor() { super('Cocomic', 'https://cocomic.co', 'en'); }

  protected override readonly useLoadMoreRequest = 'Always';
  protected override readonly useNewChapterEndpoint = true;
  protected override readonly mangaDetailsSelectorTitle = 'h1.asura-series-title';
  protected override readonly mangaDetailsSelectorAuthor: string = '.asura-chip-author .author-name-text';
  protected override readonly mangaDetailsSelectorDescription = '.asura-synopsis-content';
  protected override readonly mangaDetailsSelectorThumbnail = 'img.asura-poster-img';
  protected override readonly mangaDetailsSelectorGenre = 'a.asura-genre-tag';
  protected override readonly altNameSelector: string = 'p.asura-series-alt-title';
  protected override readonly seriesTypeSelector: string = '.asura-hero-badge-type';
  protected override readonly chapterListSelectorStr: string = 'li.wp-manga-chapter:not(.premium)';
  protected override readonly pageListParseSelector: string = 'div.asura-stream-images img';

  protected override notUpdating(text: string): boolean {
    return !/^(?:Updating|TBA)$/i.test(text);
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    let chapterElements = $(this.chapterListSelectorStr);

    if (chapterElements.length === 0) {
      const xhrRes = await this.post(
        `${mangaUrl.replace(/\/$/, '')}/ajax/chapters`,
        null,
        { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
      );
      const xhr$ = this.$(xhrRes.data);
      chapterElements = xhr$(this.chapterListSelectorStr);
    }

    return chapterElements.toArray().map(el => this.chapterFromElement($(el)));
  }
}
