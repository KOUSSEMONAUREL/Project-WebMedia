import { MangaCatalogScraper } from '../../../engine/mangacatalog';
import type { Chapter } from '../../../engine/types';

// Transcompilation of keiyoushi src/en/readattackontitanshingekinokyojinmanga
// (MangaCatalog theme with a per-site chapter selector override).
export class ReadattackontitanshingekinokyojinmangaScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Attack on Titan Shingeki no Kyojin Manga', 'https://ww12.readsnk.com', 'en');
    this.sourceList = [
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
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('div.w-full div.grid div.col-span-4').toArray().map(el => {
      const $el = $(el);
      const $a = $el.find('a').first();
      const sub = $el.find('div.text-xs').first().text().trim();
      const name = sub ? `${$a.text().trim()} - ${sub}` : $a.text().trim();
      return { name, url: this.absUrl($a.attr('href') || '') };
    });
  }
}
