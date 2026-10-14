import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/kaijimangaonline` (KaijiMangaOnline.kt).
 * The extension was renamed upstream from `MangaKa` (madara, mangaka.cc) to
 * `Kaiji Manga Online` (w9.kaijimanga.com).
 *
 * The site hosts a single manga — "Kaiji", four arcs sharing chapter numbers —
 * so the whole catalogue is one entry whose series page is the home page `/`.
 * - Chapters: `a[href*='-chapter-']`, slug regex `/manga/(.+)-chapter-(\d+)/`
 * - Arc offsets keep the arcs apart in a descending sort: kaiji 0,
 *   tobaku-datenroku-kaiji -1000, tobaku-hakairoku-kaiji -2000,
 *   tobaku-mokushiroku-kaiji -3000; chapter 0 is a prologue listed last.
 */
export class KaijiMangaOnlineScraper extends BaseScraper {
  readonly name = 'Kaiji Manga Online';
  readonly baseUrl = 'https://w9.kaijimanga.com';
  readonly lang = 'en';

  private static readonly CHAPTER_REGEX = /\/manga\/(.+)-chapter-(\d+)\/?$/;

  private static readonly ARC_OFFSETS: Record<string, number> = {
    kaiji: 0,
    'tobaku-datenroku-kaiji': -1000,
    'tobaku-hakairoku-kaiji': -2000,
    'tobaku-mokushiroku-kaiji': -3000,
  };

  private static arcTitle(arc: string): string {
    return arc.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    return {
      mangas: [{ title: 'Kaiji', url: '/', thumbnailUrl: '', lang: this.lang }],
      hasNextPage: false,
    };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const manga: Manga = { title: 'Kaiji', url: '/', thumbnailUrl: '', lang: this.lang };
    const match = manga.title.toLowerCase().includes(query.trim().toLowerCase());
    return { mangas: match ? [manga] : [], hasNextPage: false };
  }

  async getMangaDetails(_mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get('/');
    const $ = this.$(res.data as string);
    return {
      title: 'Kaiji',
      url: '/',
      thumbnailUrl: $('meta[property=\'og:image\']').first().attr('content') || '',
      description: $('meta[property=\'og:description\']').first().attr('content') || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get('/');
    const $ = this.$(res.data as string);
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    $('a[href*=\'-chapter-\']').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const match = KaijiMangaOnlineScraper.CHAPTER_REGEX.exec(href);
      if (!match) return;
      const [, arc, num] = match;
      const offset = KaijiMangaOnlineScraper.ARC_OFFSETS[arc] ?? -4000;
      const slug = `${arc}-chapter-${num}`;
      if (seen.has(slug)) return;
      seen.add(slug);
      const number = parseFloat(num);
      chapters.push({
        name: arc === 'kaiji' ? `Chapter ${num}` : `${KaijiMangaOnlineScraper.arcTitle(arc)} Chapter ${num}`,
        url: new URL(href).pathname,
        chapterNumber: number === 0 ? -9999 : offset + number,
      });
    });
    return chapters.sort((a, b) => (b.chapterNumber ?? 0) - (a.chapterNumber ?? 0));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data as string);
    return $('.entry-content img')
      .map((_i, img) => {
        const url = $(img).attr('data-src') || $(img).attr('data-lazy-src')
          || ($(img).attr('srcset') || '').split(',')[0].trim().split(' ')[0]
          || $(img).attr('src') || '';
        if (!url.startsWith('http')) return null;
        if (url.includes('cropped-')) return null;
        const isPage = url.includes('blogger.googleusercontent.com')
          || url.includes('bp.blogspot.com')
          || url.includes('img.kaijimanga.com')
          || url.includes('kaijimanga.com/wp-content/uploads');
        return isPage ? { index: _i, imageUrl: url } : null;
      })
      .get()
      .filter((p): p is Page => p !== null)
      .filter((p, index, all) => all.findIndex((q) => q.imageUrl === p.imageUrl) === index)
      .map((p, index) => ({ index, imageUrl: p.imageUrl }));
  }
}

export default KaijiMangaOnlineScraper;
