import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const GALLERY_SELECTOR = '.pswp-gallery .pswp-gallery__item a[href]';

export class XyzComicsScraper extends BaseScraper {
  readonly name = 'XYZ Comics';
  readonly baseUrl = 'https://xyzcomics.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const path = page <= 1 ? '/allsexkomix/' : `/allsexkomix/page/${page}/`;
    return this.parseList(path);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const term = query.trim();
    if (!term) return this.getPopular(page);
    if (page > 1) return { mangas: [], hasNextPage: false };
    return this.parseList(`/allsexkomix/?s=${encodeURIComponent(term)}`);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const $ = this.$(await this.fetchHtml(mangaUrl));
    const genres = $('a.post-tag-button').toArray()
      .map(el => $(el).text().trim())
      .filter(Boolean);
    return {
      title: this.title($) || undefined,
      url: mangaUrl,
      thumbnailUrl: this.cover($) || undefined,
      genre: genres.length > 0 ? genres.join(', ') : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const $ = this.$(await this.fetchHtml(mangaUrl));
    const chapters = new Map<string, Chapter>();
    $('a[href*="?chapter="]').toArray().forEach(el => {
      const href = (el.attribs.href || '').trim();
      if (!href) return;
      const url = this.absUrl(href);
      if (chapters.has(url)) return;
      const name = this.chapterName($(el).text());
      if (!name) return;
      chapters.set(url, { name, url });
    });
    return [...chapters.values()];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const $ = this.$(await this.fetchHtml(chapterUrl));
    const urls = new Set<string>();
    $(GALLERY_SELECTOR).toArray().forEach(el => {
      const href = (el.attribs.href || '').trim();
      if (!href) return;
      const url = this.absUrl(href);
      if (!url.includes('/wp-content/uploads/')) return;
      urls.add(url);
    });
    return [...urls].map((imageUrl, index) => ({ index, imageUrl }));
  }

  private async parseList(path: string): Promise<SearchResult> {
    const $ = this.$(await this.fetchHtml(path));
    const mangas = $('article.post').toArray().map(el => {
      const post = $(el);
      const titleEl = post.find('h2.post-title a').first();
      const thumbLink = post.find('figure.post-image a').first();
      const title = titleEl.text().trim();
      const url = this.absUrl(thumbLink.attr('href') || titleEl.attr('href') || '');
      if (!title || !url) return null;
      const image = post.find('figure.post-image img.wp-post-image').first();
      const thumbnailUrl = this.absUrl(image.attr('data-src') || image.attr('src') || '');
      return { title, url, thumbnailUrl: thumbnailUrl || undefined, lang: this.lang };
    }).filter((manga): manga is Manga => manga !== null);
    return { mangas, hasNextPage: false };
  }

  private async fetchHtml(path: string): Promise<string> {
    return (await this.get(path)).data as string;
  }

  private title($: CheerioAPI): string {
    return $('h1.post-title a, h1.post-title').first().text().trim()
      || $('title').first().text().trim();
  }

  private cover($: CheerioAPI): string {
    const gallery = $(GALLERY_SELECTOR).first().attr('href');
    if (gallery) return this.absUrl(gallery);
    return this.absUrl($('meta[property="og:image"]').attr('content') || '');
  }

  private chapterName(text: string): string {
    return text
      .replace(/\s*(NEW|HOT|FREE)\b.*$/i, '')
      .replace(/\s+\d+\s*p\b.*$/i, '')
      .trim();
  }
}

export default XyzComicsScraper;
