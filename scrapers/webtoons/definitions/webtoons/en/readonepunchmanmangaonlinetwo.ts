import { MangaCatalogScraper } from '../../../engine/mangacatalog';
import type { Chapter, Manga } from '../../../engine/types';

// Transcompilation of keiyoushi src/en/readonepunchmanmangaonlinetwo (MangaCatalog
// theme with per-site details/chapters overrides).
export class ReadonepunchmanmangaonlinetwoScraper extends MangaCatalogScraper {
  constructor() {
    super('Read One-Punch Man Manga Online', 'https://ww7.readopm.com', 'en');
    this.sourceList = [
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
  }

  override async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const rawTitle = $('h2 > span').first().text().trim();
    const marker = 'Manga: ';
    const title = rawTitle.includes(marker)
      ? rawTitle.substring(rawTitle.indexOf(marker) + marker.length).trim()
      : rawTitle;
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.card-img-right').first().attr('src') || ''),
      description: $('div.card-body > p').first().text().trim() || undefined,
      lang: this.lang,
    };
  }

  override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('tbody > tr').toArray().map(el => {
      const $el = $(el);
      const name = $el.find('td:first-child').first().text().trim();
      const url = this.absUrl($el.find('a').first().attr('href') || '');
      const dateText = $el.find('td:nth-child(2)').first().text().trim();
      const parsed = dateText ? Date.parse(dateText) : NaN;
      return {
        name,
        url,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    });
  }
}
