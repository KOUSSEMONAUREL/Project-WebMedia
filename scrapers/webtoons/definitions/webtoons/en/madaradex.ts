import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';
export class MadaradexScraper extends MadaraScraper {
  constructor() { super('MadaraDex', 'https://madaradex.org', 'en', 'MMM d, yyyy'); }
  protected override readonly mangaSubString = 'title';
  protected override imageFromElement(el: ReturnType<CheerioAPI>): string | null {
    const attrVal = (name: string) => el.attr(name)?.trim();
    const lazy = attrVal('data-src') ?? attrVal('data-lazy-src');
    if (lazy) return this.absUrl(lazy);
    const srcset = attrVal('srcset');
    if (srcset) return this.getSrcSetImage(srcset);
    const cfsrc = attrVal('data-cfsrc') ?? attrVal('data-manga-src');
    if (cfsrc) return this.absUrl(cfsrc);
    const plain = attrVal('src');
    if (plain) return this.absUrl(plain);
    return null;
  }
}