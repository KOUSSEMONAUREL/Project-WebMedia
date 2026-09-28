import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadonepunchmanmangaonlinetwoScraper extends MangaCatalogScraper {
  constructor() {
    super('Read One Punch Man Manga Online Two', 'https://ww7.readopm.com', 'en');
  }

  protected override readonly sourceList = [
    { name: 'One Punch Man', url: `${this.baseUrl}/manga/one-punch-man/` },
    { name: 'Official', url: `${this.baseUrl}/manga/one-punch-man-official/` },
    { name: 'Onepunch-Man (ONE)', url: `${this.baseUrl}/manga/onepunch-man-one/` },
    { name: 'Colored', url: `${this.baseUrl}/manga/one-punch-man-colored/` },
    { name: 'Mob Psycho 100', url: `${this.baseUrl}/manga/mob-psycho-100/` },
    { name: 'Reigen', url: `${this.baseUrl}/manga/reigen/` },
    { name: 'Versus (ONE)', url: `${this.baseUrl}/manga/versus/` },
    { name: 'Bug Ego', url: `${this.baseUrl}/manga/bug-ego/` },
    { name: 'Eyeshield 21', url: `${this.baseUrl}/manga/eyeshield-21/` },
  ];

  override async getMangaDetails(mangaUrl: string) {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const rawTitle = $('h2 > span').first().text().trim();
    const title = rawTitle.includes('Manga:') ? rawTitle.substring(rawTitle.indexOf('Manga:') + 'Manga:'.length).trim() : rawTitle;
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.card-img-right').first().attr('src') || ''),
      lang: this.lang,
      description: $('div.card-body > p').first().text().trim() || undefined,
    };
  }

  override async getChapterList(mangaUrl: string) {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('tbody > tr').toArray().map(el => {
      const $el = $(el);
      const name = $el.find('td:first-child').first().text().trim();
      const url = this.absUrl($el.find('a').first().attr('href') || '');
      const rawDate = $el.find('td:nth-child(2)').first().text().trim();
      const parsed = Date.parse(rawDate);
      return { name, url, dateUpload: Number.isNaN(parsed) ? undefined : parsed };
    });
  }
}
