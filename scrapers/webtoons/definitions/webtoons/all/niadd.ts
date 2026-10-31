import type { AxiosRequestConfig } from 'axios';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const UA = 'okhttp/4.12.0';

export class NiaddScraper extends BaseScraper {
  readonly name = 'Niadd';
  readonly baseUrl = 'https://www.niadd.com';
  readonly lang = 'all';

  constructor() {
    super();
    this.client.defaults.headers.common['User-Agent'] = UA;
  }

  protected async get(pathOrUrl: string, config?: AxiosRequestConfig) {
    const headers = {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      ...config?.headers,
    };
    return this.client.get(this.absUrl(pathOrUrl), { ...config, headers });
  }

  async getPopular(): Promise<SearchResult> {
    return this.catalogue('/list/Hot-Manga.html');
  }

  async getLatest(): Promise<SearchResult> {
    return this.catalogue('/list/New-Update.html');
  }

  async getSearch(query: string): Promise<SearchResult> {
    return this.catalogue(`/search/?name=${encodeURIComponent(query.trim())}`);
  }

  private async catalogue(path: string): Promise<SearchResult> {
    const res = await this.get(path);
    const $ = this.$(String(res.data));
    const mangas: Manga[] = [];
    $('div.manga-item').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('a').first();
      const href = $link.attr('href') ?? '';
      const title = $el.find('div.manga-name').first().text().trim();
      if (!href || !title) return;
      const thumb = $el.find('div.manga-img img').first().attr('src') ?? '';
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: this.absUrl(thumb),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const $info = $('div.bookside-general, div.detail-general');
    const author = $info.find('[itemprop="author"] span').first().text()
      .replace(/Autor \(es\):/i, '').trim();
    const artist = $info.find('.detail-general-cell').filter((_i, el) => /Artista/i.test($(el).text()))
      .find('span').first().text().replace(/Artista:/i, '').trim();
    const genre = $('[itemprop="genre"]').map((_i, el) => $(el).text().trim()).get().join(', ');
    const thumb = $('div.detail-img img, div.bookside-img img').first().attr('src') ?? '';
    return {
      title: $('h1, .book-headline-name').first().text().trim(),
      thumbnailUrl: this.absUrl(thumb),
      author: author || undefined,
      artist: artist || undefined,
      genre: genre || undefined,
      description: $('meta[name="description"]').attr('content')?.trim() || undefined,
      status: 1,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.absUrl(mangaUrl).replace(/\.html$/, '') + '/chapters.html';
    const res = await this.get(url);
    const $ = this.$(String(res.data));
    const chapters: Chapter[] = [];
    $('ul.chapter-list a.hover-underline').each((_i, el) => {
      const $el = $(el);
      const href = $el.attr('href') ?? '';
      const name = $el.find('span.chp-title, span.chapter-name, span.name').first().text().trim()
        || $el.text().trim();
      if (!href || !/\/chapter\//.test(href)) return;
      const numberMatch = /Ch\.\s*([\d.]+)/i.exec(name) ?? /(\d+(?:\.\d+)?)\s*$/.exec(name);
      const number = numberMatch ? Number(numberMatch[1]) : undefined;
      const date = $el.find('span.chp-time, span.chapter-time, span.time').first().text().trim();
      chapters.push({
        name,
        url: this.absUrl(href),
        chapterNumber: Number.isFinite(number) ? number : undefined,
        dateUpload: date ? Date.parse(date) : undefined,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(String(res.data));
    const subPages = $('select.sl-page option')
      .map((_i, el) => $(el).attr('value') ?? '')
      .get()
      .filter(url => url.length > 0);
    const urls = subPages.length > 0 ? subPages : [this.absUrl(chapterUrl)];
    const documents = await Promise.all(urls.map(async url => {
      if (url === this.absUrl(chapterUrl)) return $;
      try {
        const pageRes = await this.get(url);
        return this.$(String(pageRes.data));
      } catch {
        return null;
      }
    }));
    const pages: Page[] = [];
    for (const doc of documents) {
      if (!doc) continue;
      doc('div.pic_box img.manga_pic, div.reading-content img').each((_i, el) => {
        const src = doc(el).attr('src') ?? '';
        if (!src || /cover|logo/i.test(src)) return;
        pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
      });
    }
    return pages;
  }
}
