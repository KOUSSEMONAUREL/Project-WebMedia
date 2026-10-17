import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class TheexiledheavyknightmangaonlineScraper extends BaseScraper {
  readonly name = 'Read The Exiled Heavy Knight Manga Online';
  readonly baseUrl = 'https://w2.theexiledheavyknight.com';
  readonly lang = 'en';

  private singleManga(): Manga {
    return { title: 'The Exiled Heavy Knight', url: '/', thumbnailUrl: '', lang: this.lang };
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
      title: 'The Exiled Heavy Knight',
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
    $('a[href*="the-exiled-heavy-knight-knows-how-to-game-the-system-chapter-"]').each((_, el) => {
      const href = this.absUrl($(el).attr('href') || '');
      const m = /the-exiled-heavy-knight-knows-how-to-game-the-system-chapter-(\d+)\/?$/.exec(href);
      if (!m) return;
      const num = m[1];
      if (!seen.add(num)) return;
      chapters.push({ name: `Chapter ${num}`, url: href, chapterNumber: Number(num) || 0 });
    });
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const urls: string[] = [];
    $('.post-single-content img, .entry-content img').each((_, el) => {
      const $el = $(el);
      const url =
        $el.attr('data-src') ||
        $el.attr('data-lazy-src') ||
        ($el.attr('srcset') || '').split(',')[0].split(' ')[0].trim() ||
        this.absUrl($el.attr('src') || '');
      if (!url || !url.startsWith('http')) return;
      if (url.includes('cropped-')) return;
      if (!url.includes('blogger.googleusercontent.com') && !url.includes('bp.blogspot.com') && !url.includes('pic.readkakegurui.com') && !url.includes('img.theexiledheavyknight.com') && !url.includes('theexiledheavyknight.com/wp-content/uploads')) return;
      if (!urls.includes(url)) urls.push(url);
    });
    return urls.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
