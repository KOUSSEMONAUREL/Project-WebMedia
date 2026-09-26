import { MadaraScraper } from '../../../engine/madara';

export class LilymangaScraper extends MadaraScraper {
  constructor() { super('Lily Manga', 'https://lilymanga.net', 'en', 'dd.MM.yyyy'); }
  protected override readonly mangaSubString = 'gl';
  protected override readonly useNewChapterEndpoint = true;
  protected override readonly useLoadMoreRequest = 'Never';

  // La recherche du site renvoie les memes cartes d'archive que la liste
  // (div.page-item-detail) et aucun element c-tabs-item__content ni
  // manga__item: le selecteur de recherche par defaut du moteur ne
  // selectionne donc rien. On reutilise le selecteur d'archive.
  protected override searchMangaSelector(): string {
    return this.popularMangaSelector();
  }
}
