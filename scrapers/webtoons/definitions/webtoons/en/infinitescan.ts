import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface Site {
  series: string[];
  imageHost: string;
}

type ChapterCounts = Record<string, number>;

const GALLERY_REGEX = /\/gallery\/([a-z0-9]+(?:-[a-z0-9]+)*)\.webp/g;
const IMAGE_HOST_REGEX = /https:\/\/pub-[0-9a-f]+\.r2\.dev/;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

export class InfiniteScanScraper extends BaseScraper {
  override readonly name = 'Infinite-Scan';
  override readonly baseUrl = 'https://www.infinite-scan.com';
  override readonly lang = 'en';

  private site: Site | null = null;

  async getPopular(_page = 1): Promise<SearchResult> {
    const site = await this.getSite(true);
    return { mangas: site.series.map(slug => this.seriesManga(slug)), hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const site = await this.getSite();
    const search = query.trim().toLowerCase();
    const mangas = site.series
      .map(slug => this.seriesManga(slug))
      .filter(manga => manga.title.toLowerCase().includes(search));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.seriesSlug(mangaUrl);
    const counts = await this.getChapterCounts(slug);
    if (!counts) throw new Error('InfiniteScan: series not found');
    return this.seriesManga(slug);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.seriesSlug(mangaUrl);
    const counts = await this.getChapterCounts(slug);
    if (!counts) throw new Error('InfiniteScan: series not found');
    return Object.keys(counts)
      .map(key => ({ key, number: Number(key.replace(/^chapter_/, '')) }))
      .filter(item => Number.isInteger(item.number))
      .sort((a, b) => b.number - a.number)
      .map(item => ({
        name: `Chapter ${item.number}`,
        url: `${this.baseUrl}/#/${slug}/${item.number}`,
        chapterNumber: item.number,
      }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const { slug, number } = this.chapterParts(chapterUrl);
    const key = `chapter_${String(number).padStart(3, '0')}`;
    const counts = await this.getChapterCounts(slug);
    const count = counts?.[key];
    if (count === undefined) throw new Error('InfiniteScan: chapter not found');
    const site = await this.getSite();
    const folder = `${site.imageHost}/book/${slug}/${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    return Array.from({ length: count }, (_, index) => ({
      index,
      imageUrl: `${folder}/${String(index + 1).padStart(2, '0')}.webp`,
    }));
  }

  private async getSite(refresh = false): Promise<Site> {
    if (this.site && !refresh) return this.site;
    const response = await this.get(this.baseUrl);
    const $ = this.$(response.data);
    const scriptUrl = $('script[type=module][src]').first().attr('src');
    if (!scriptUrl) throw new Error('InfiniteScan: script not found');
    const scriptResponse = await this.get(this.absUrl(scriptUrl));
    const script = String(scriptResponse.data);
    const slugs: string[] = [];
    for (const match of script.matchAll(GALLERY_REGEX)) {
      const slug = match[1];
      if (!slug.endsWith('-thumb-small') && !slugs.includes(slug)) slugs.push(slug);
    }
    const imageHost = IMAGE_HOST_REGEX.exec(script)?.[0];
    if (!imageHost) throw new Error('InfiniteScan: image host not found');
    const checked = await Promise.all(
      slugs.map(async slug => (await this.getChapterCounts(slug)) !== null ? slug : null),
    );
    const series = checked.filter((slug): slug is string => slug !== null);
    this.site = { series, imageHost };
    return this.site;
  }

  private async getChapterCounts(slug: string): Promise<ChapterCounts | null> {
    const response = await this.get(`/json/${slug}.json`, { validateStatus: () => true });
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`InfiniteScan: HTTP ${response.status}`);
    }
    const data = response.data as Record<string, ChapterCounts>;
    return data[slug] ?? null;
  }

  private seriesManga(slug: string): Manga {
    return {
      url: `${this.baseUrl}/#/${slug}`,
      title: slug.split('-')
        .map((word, index) => index > 0 && SMALL_WORDS.has(word)
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
      thumbnailUrl: `${this.baseUrl}/gallery/${slug}.webp`,
      lang: this.lang,
    };
  }

  private seriesSlug(url: string): string {
    const slug = this.pathParts(url)[0];
    if (!slug) throw new Error('InfiniteScan: invalid series URL');
    return slug;
  }

  private chapterParts(url: string): { slug: string; number: number } {
    const [slug, numberText] = this.pathParts(url);
    const number = Number(numberText);
    if (!slug || !Number.isInteger(number)) throw new Error('InfiniteScan: invalid chapter URL');
    return { slug, number };
  }

  private pathParts(url: string): string[] {
    const parsed = new URL(this.absUrl(url));
    const raw = parsed.hash ? parsed.hash.replace(/^#\/?/, '') : parsed.pathname.replace(/^\/+/, '');
    return raw.split('/').filter(Boolean);
  }
}
