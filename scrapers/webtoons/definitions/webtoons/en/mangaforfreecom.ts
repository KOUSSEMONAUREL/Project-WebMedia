import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';
import type { Page } from '../../../engine/types';
export class MangaforfreecomScraper extends MadaraScraper {
  constructor() { super('Mangaforfree.com', 'https://mangaforfree.com', 'en'); }
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
  public override async getPageList(chapterUrl: string): Promise<Page[]> {
    const pages = await super.getPageList(chapterUrl);
    return pages.map(p => ({ ...p, imageUrl: p.imageUrl.replace('http://', 'https://') }));
  }
}