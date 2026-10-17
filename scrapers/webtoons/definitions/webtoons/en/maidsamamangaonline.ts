import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class MaidsamamangaonlineScraper extends BaseScraper {
  readonly name = 'Read Maid Sama Manga Online';
  readonly baseUrl = 'https://w14.maid-sama.com';
  readonly lang = 'en';

  private singleManga(): Manga {
    return { title: 'Maid Sama', url: '/', thumbnailUrl: '', lang: this.lang };
  }

  async getPopular(_page: number = 1): Promise<SearchResult> {
    return { mangas: [this.singleManga()], hasNextPage: false };
  }

  async getLatest(_page: number = 1): Promise<SearchResult> {
    throw new Error('getLatest is not supported');
  }

  async getSearch(query: string, _page: number = 1): Promise<SearchResult> {
    const manga = this.singleManga();
    return manga.title.toLowerCase().includes(query.trim().toLowerCase())
      ? { mangas: [manga], hasNextPage: false }
      : { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    return {
      title: 'Maid Sama',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('meta[property="og:image"]').first().attr('content') || ''),
      description: $('meta[property="og:description"]').first().attr('content') || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.baseUrl);
    const $ = this.$(res.data);
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    $('a[href*="maid-sama-chapter-"]').each((_, el) => {
      const href = this.absUrl($(el).attr('href') || '');
      const m = /maid-sama-chapter-(.+?)\/?$/.exec(href);
      if (!m) return;
      const slug = m[1];
      if (!seen.add(slug)) return;
      const special = /oneshot-special-(\d+)/.exec(slug);
      let name = '';
      let number = 0;
      if (special) {
        name = `Oneshot Special ${special[1]}`;
        number = 86 + Number(special[1]) / 100;
      } else {
        name = 'Chapter ' + slug.replace(/-/g, '.');
        let num = 0;
        let div = 1;
        for (const part of slug.split('-')) {
          num += (Number(part) || 0) / div;
          div *= 10;
        }
        number = num;
      }
      chapters.push({ name, url: this.absUrl(href), chapterNumber: number });
    });
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const urls: string[] = [];
    $('.entry-content img').each((_, el) => {
      const $el = $(el);
      const url =
        $el.attr('data-src') ||
        $el.attr('data-lazy-src') ||
        ($el.attr('srcset') || '').split(',')[0].split(' ')[0].trim() ||
        $el.attr('abs:src') ||
        '';
      if (!url || !url.startsWith('http')) return;
      if (url.includes('cropped-')) return;
      if (!url.includes('blogger.googleusercontent.com') && !url.includes('bp.blogspot.com') && !url.includes('img.maid-sama.com')) return;
      if (!urls.includes(url)) urls.push(url);
    });
    return urls.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
