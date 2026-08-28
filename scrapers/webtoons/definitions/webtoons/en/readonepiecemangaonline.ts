import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadonepiecemangaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read One Piece Manga Online', 'https://ww13.readonepiece.com', 'en');
  }

  protected override readonly sourceList = [
    { name: 'One Piece', url: `${this.baseUrl}/manga/one-piece/` },
    { name: 'Colored', url: `${this.baseUrl}/manga/one-piece-digital-colored-comics/` },
    { name: "Soma x Sanji", url: `${this.baseUrl}/manga/shokugeki-no-sanji-one-shot/` },
    { name: 'OP x Toriko', url: `${this.baseUrl}/manga/one-piece-x-toriko/` },
    { name: 'Party', url: `${this.baseUrl}/manga/one-piece-party/` },
    { name: 'DB x OP', url: `${this.baseUrl}/manga/dragon-ball-x-one-piece/` },
    { name: 'Wanted!', url: `${this.baseUrl}/manga/wanted-one-piece/` },
    { name: "Ace's Story", url: `${this.baseUrl}/manga/one-piece-ace-s-story/` },
    { name: 'Omake', url: `${this.baseUrl}/manga/one-piece-omake/` },
    { name: 'Vivre Card', url: `${this.baseUrl}/manga/vivre-card-databook/` },
    { name: 'Pirate Recipes', url: `${this.baseUrl}/manga/one-piece-pirate-recipes/` },
    { name: 'Databook', url: `${this.baseUrl}/manga/one-piece-databook/` },
    { name: "Ace's Story Manga", url: `${this.baseUrl}/manga/one-piece-ace-story-manga/` },
    { name: 'OP Academy', url: `${this.baseUrl}/manga/one-piece-academy/` },
    { name: 'MONSTERS', url: `${this.baseUrl}/manga/monsters/` },
    { name: 'Zoro Novel', url: `${this.baseUrl}/manga/one-piece-novel-zoro/` },
    { name: 'OP in Love', url: `${this.baseUrl}/manga/one-piece-in-love/` },
    { name: 'Heroines', url: `${this.baseUrl}/manga/one-piece-novel-heroines/` },
  ];
}