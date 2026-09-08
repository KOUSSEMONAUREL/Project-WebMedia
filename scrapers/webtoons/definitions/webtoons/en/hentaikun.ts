import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class HentaikunScraper extends BaseScraper {
  readonly name = 'HentaiKun';
  readonly baseUrl = 'https://hentaikun.com';
  readonly lang = 'en';
  private readonly mangaUrl = 'https://hentaikun.com/manga';
  private async parseTableListing(html: string): Promise<Manga[]> {
    const $ = this.$(html);
    return $('table.table-striped tr:not(.danger)').toArray().map(el => {
      const $el = $(el);
      const anchor = $el.find('td:first-child a');
      const title = anchor.text();
      const url = this.absUrl(anchor.attr('href') || '');
      const thumbHtml = anchor.attr('title') || '';
      const $thumb = thumbHtml ? this.$(thumbHtml) : null;
      const thumbnailUrl = $thumb ? this.absUrl($thumb('img').attr('src') || '') : '';
      return { title, url, thumbnailUrl, lang: 'en' };
    }).filter(m => m.title);
  }
  private async parseGalleryListing(html: string): Promise<Manga[]> {
    const $ = this.$(html);
    return $('div.thumbnail[id^=galary-]').toArray().map(el => {
      const $el = $(el);
      const overlayAnchor = $el.find('div.overlay a');
      const title = overlayAnchor.text();
      const url = this.absUrl(overlayAnchor.attr('href') || '');
      const thumbnailUrl = this.absUrl($el.find('img.img-responsive').attr('src') || '');
      return { title, url, thumbnailUrl, lang: 'en' };
    }).filter(m => m.title);
  }
  async getPopular(page = 1): Promise<SearchResult> {
    const pageStr = page > 1 ? `${page}/` : '';
    const res = await this.get(`${this.mangaUrl}/manga-list/most-viewed/${pageStr}`);
    const $ = this.$(res.data);
    const mangas = await this.parseTableListing(res.data);
    const hasNextPage = $('ul.pagination li[aria-label=Next]').length > 0;
    return { mangas, hasNextPage };
  }
  async getLatest(page = 1): Promise<SearchResult> {
    const pageStr = page > 1 ? `${page}/` : '';
    const res = await this.get(`${this.mangaUrl}/manga-list/last-updated/${pageStr}`);
    const $ = this.$(res.data);
    const mangas = await this.parseTableListing(res.data);
    const hasNextPage = $('ul.pagination li[aria-label=Next]').length > 0;
    return { mangas, hasNextPage };
  }
  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const pageStr = page > 1 ? `${page}/` : '';
    const res = await this.get(`${this.mangaUrl}/search/title/${encodeURIComponent(query.trim())}/${pageStr}`);
    const $ = this.$(res.data);
    const hasNextPage = $('ul.pagination li[aria-label=Next]').length > 0;
    const mangas = $('table.table-striped').length > 0
      ? await this.parseTableListing(res.data)
      : await this.parseGalleryListing(res.data);
    return { mangas, hasNextPage };
  }
  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('div.single_title h1').text();
    if (!title) throw new Error('Title not found');
    const thumbnailUrl = this.absUrl($("meta[property='og:image']").attr('content') || '');
    const author = $('h2:has(strong:contains(Artist)) a').toArray().map(el => $(el).text()).join(', ') || undefined;
    const category = $('h2:has(strong:contains(Category)) a').text();
    const tags = $("div.desc a[href*='/tag/'] span.label-danger").toArray().map(el => $(el).text());
    const genre = [category, ...tags].filter(Boolean).join(', ') || undefined;
    return { title, url: mangaUrl, thumbnailUrl, lang: 'en', author, description: genre };
  }
  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('table a.readchap').toArray().map(el => {
      const $el = $(el);
      const name = $el.text() || 'Chapter';
      const url = this.absUrl(($el.attr('href') || '').trim());
      const row = $el.closest('tr');
      const dateText = row.find('td:last-child h6').text();
      const dateUpload = dateText ? new Date(dateText).getTime() || undefined : undefined;
      const chapterNumber = name.match(/(\d+(?:\.\d+)?)/)?.[1] ? parseFloat(name.match(/(\d+(?:\.\d+)?)/)![1]) : 1;
      return { name, url, dateUpload, chapterNumber };
    });
  }
  async getPageList(chapterUrl: string): Promise<Page[]> {
    // Upstream 6ca40f6: force "All page" mode via cookie "$chapterKey=2"
    // https://hentaikun.com/manga/<category>/<slug>/<chapter> -> chapterKey = "slug/chapter"
    let cookieHeader = '';
    try {
      const u = new URL(this.absUrl(chapterUrl));
      const segs = u.pathname.split('/').filter(Boolean);
      // segs: ["manga", "<category>", "<slug>", "<chapter>", ...]
      if (segs[0] === 'manga' && segs.length >= 4) {
        const chapterKey = `${segs[2]}/${segs[3]}`;
        cookieHeader = `${chapterKey}=2`;
      }
    } catch { /* ignore */ }

    const res = await this.get(chapterUrl, cookieHeader ? { headers: { Cookie: cookieHeader } } : undefined);
    const $ = this.$(res.data);

    // Preferred: upstream now embeds var jsondata=[...]
    const scriptData = $('script').toArray().map(el => $(el).html() || '').join('\n');
    const jsonMatch = scriptData.match(/var\s+jsondata\s*=\s*(\[.*?\]);/s);
    if (jsonMatch) {
      try {
        const urls = JSON.parse(jsonMatch[1]) as string[];
        if (Array.isArray(urls) && urls.length > 0) {
          return urls.map((imageUrl, index) => ({ index, imageUrl: this.absUrl(imageUrl) }));
        }
      } catch { /* fall through to legacy */ }
    }

    // Legacy fallback: single image_rin + page count reconstruction
    const firstImageUrl = $('img.image_rin').attr('src')?.trim();
    if (!firstImageUrl) throw new Error('Could not find any images for this chapter.');
    const totalPages = $('label:contains(Page) + select option').length || $('select[onchange]').last().find('option').length || 0;
    if (totalPages === 0) return [{ index: 0, imageUrl: this.absUrl(firstImageUrl) }];
    const basePath = firstImageUrl.replace(/\/[^/]*$/, '') + '/';
    const fileName = firstImageUrl.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    const ext = firstImageUrl.split('.').pop() || '';
    const prefix = fileName.replace(/\d+$/, '');
    const numberPart = fileName.substring(prefix.length);
    const padLength = numberPart.length;
    return Array.from({ length: totalPages }, (_, i) => {
      const pageNum = padLength > 0 ? String(i + 1).padStart(padLength, '0') : String(i + 1);
      return { index: i, imageUrl: `${basePath}${prefix}${pageNum}.${ext}` };
    });
  }
}
