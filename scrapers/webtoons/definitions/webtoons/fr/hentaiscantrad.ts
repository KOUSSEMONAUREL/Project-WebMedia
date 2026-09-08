import type { CheerioAPI } from 'cheerio';
import { MadaraScraper } from '../../../engine/madara';

export class HentaiscantradScraper extends MadaraScraper {
  constructor() {
    super('Hentai-Scantrad', 'https://hentai-scantrad.org', 'fr', 'd MMMM, yyyy');
  }

  // @ts-ignore - allow overriding literal type with French selector
  protected override readonly mangaDetailsSelectorStatus = 'div.summary-heading:contains(État) + .summary-content';
  protected override readonly mangaSubString = 'manga';
  protected override readonly useNewChapterEndpoint = false;

  protected override imageFromElement(el: ReturnType<CheerioAPI>): string | null {
    const raw = (el.attr('data-src') || el.attr('data-lazy-src') || el.attr('src') || '').trim();
    if (!raw) return null;
    // Handle srcset etc. by trimming and picking first URL
    if (raw.includes(' ')) {
      const first = raw.split(/\s+/)[0].trim();
      if (first) return this.absUrl(first);
    }
    return this.absUrl(raw);
  }
}
