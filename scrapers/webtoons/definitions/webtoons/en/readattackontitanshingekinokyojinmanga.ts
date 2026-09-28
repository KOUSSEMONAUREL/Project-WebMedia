import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadattackontitanshingekinokyojinmangaScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Attack On Titan Shingeki No Kyojin Manga', 'https://ww12.readsnk.com', 'en');
  }

  protected override readonly sourceList = [
    { name: 'Shingeki No Kyojin', url: `${this.baseUrl}/manga/shingeki-no-kyojin/` },
    { name: 'Colored', url: `${this.baseUrl}/manga/shingeki-no-kyojin-colored/` },
    { name: 'Before the Fall', url: `${this.baseUrl}/manga/shingeki-no-kyojin-before-the-fall/` },
    { name: 'Lost Girls', url: `${this.baseUrl}/manga/shingeki-no-kyojin-lost-girls/` },
    { name: 'No Regrets', url: `${this.baseUrl}/manga/attack-on-titan-no-regrets/` },
    { name: 'Junior High', url: `${this.baseUrl}/manga/attack-on-titan-junior-high/` },
    { name: 'Guidebook', url: `${this.baseUrl}/manga/attack-on-titan-guidebook-inside-outside/` },
    { name: 'Harsh Mistress', url: `${this.baseUrl}/manga/attack-on-titan-harsh-mistress-of-the-city/` },
    { name: 'Anthology', url: `${this.baseUrl}/manga/attack-on-titan-anthology/` },
    { name: 'Art Book', url: `${this.baseUrl}/manga/attack-on-titan-exclusive-art-book/` },
    { name: 'Spoof', url: `${this.baseUrl}/manga/spoof-on-titan/` },
    { name: 'No Regrets Colored', url: `${this.baseUrl}/manga/attack-on-titan-no-regrets-colored/` },
    { name: 'BTF Light Novel', url: `${this.baseUrl}/manga/attack-on-titan-before-the-fall-light-novel/` },
    { name: 'Best of SNK', url: `${this.baseUrl}/manga/the-best-of-attack-on-titan-in-color/` },
  ];

  override async getChapterList(mangaUrl: string) {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('div.w-full div.grid div.col-span-4').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('a').first();
      const name1 = link.text().trim();
      const name2 = $el.find('div.text-xs').first().text().trim();
      const name = name2 ? `${name1} - ${name2}` : name1;
      return { name, url: this.absUrl(link.attr('href') || '') };
    });
  }
}
