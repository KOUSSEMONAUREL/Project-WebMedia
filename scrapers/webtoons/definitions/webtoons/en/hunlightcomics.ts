import { MadaraScraper } from '../../../engine/madara';

export class HunlightcomicsScraper extends MadaraScraper {
  constructor() {
    super('Hunlight Comics', 'https://hunlightcomics.com', 'en');
  }

  protected override readonly mangaSubString = 'm';
  protected override readonly useNewChapterEndpoint = true;

  protected override imageFromElement(el: ReturnType<ReturnType<typeof import('cheerio').load>>): string | null {
    const getTrimmed = (attr: string | undefined): string | null => {
      if (!attr) return null;
      const t = attr.trim();
      return t.length > 0 ? t : null;
    };
    const dataSrc = getTrimmed(el.attr('data-src'));
    if (dataSrc) return this.absUrl(dataSrc);
    const dataLazy = getTrimmed(el.attr('data-lazy-src'));
    if (dataLazy) return this.absUrl(dataLazy);
    const srcset = el.attr('srcset');
    if (srcset) {
      const t = srcset.trim();
      if (t) {
        const url = this.getSrcSetImage(t);
        if (url) return this.absUrl(url.trim());
      }
    }
    const cfsrc = getTrimmed(el.attr('data-cfsrc'));
    if (cfsrc) return this.absUrl(cfsrc);
    const mangaSrc = getTrimmed(el.attr('data-manga-src'));
    if (mangaSrc) return this.absUrl(mangaSrc);
    const src = getTrimmed(el.attr('src'));
    if (src) return this.absUrl(src);
    return null;
  }
}
