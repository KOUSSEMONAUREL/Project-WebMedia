import { MangaCatalogScraper } from '../../../engine/mangacatalog';
import type { Chapter, Manga, Page } from '../../../engine/types';

// Transcompilation of keiyoushi src/en/readberserkmanga (MangaCatalog theme
// with per-site details/chapters/pages overrides).
export class ReadberserkmangaScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Berserk Manga', 'https://readberserk.com', 'en');
    this.sourceList = [
      { name: 'Berserk', url: `${this.baseUrl}/manga/berserk/` },
      { name: 'Guidebook', url: `${this.baseUrl}/manga/berserk-official-guidebook/` },
      { name: 'Colored', url: `${this.baseUrl}/manga/berserk-colored/` },
      { name: 'Duranki', url: `${this.baseUrl}/manga/duranki/` },
      { name: 'Gigantomakhia', url: `${this.baseUrl}/manga/gigantomakhia/` },
      { name: 'Futatabi', url: `${this.baseUrl}/manga/futatabi/` },
      { name: 'Berserk Spoilers & RAW', url: `${this.baseUrl}/manga/berserk-spoilers-raw/` },
    ];
  }

  override async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return {
      title: $('h2 > span').first().text().trim(),
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
      const url = this.absUrl($el.find('a.btn-primary').first().attr('href') || '');
      const dateText = $el.find('td:nth-child(2)').first().text().trim();
      const parsed = dateText ? Date.parse(dateText) : NaN;
      return {
        name,
        url,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    });
  }

  override async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.pages img.pages__img').toArray().map((el, index) => ({
      index,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}
