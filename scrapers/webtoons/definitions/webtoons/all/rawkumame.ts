import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface SeriesInfo {
  slug: string;
  title: string;
  altTitles: string[];
  cover: string;
  synopsis: string;
  author: string;
  artist: string;
  genres: string[];
  status: string;
  chapters: ChapterInfo[];
}

interface ChapterInfo {
  slug: string;
  number: number;
  releasedAt: string;
  translatedAt: string;
  langs: string[];
}

const LANG = 'en';

export class RawkumameScraper extends BaseScraper {
  readonly name = 'RawkumaMe';
  readonly baseUrl = 'https://rawkuma.me';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.parseListing((await this.get(this.listingUrl('popular', page))).data as string);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.parseListing((await this.get(this.listingUrl('date', page))).data as string);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.listingUrl('popular', page));
    url.searchParams.set('q', query.trim());
    return this.parseListing((await this.get(url.toString())).data as string);
  }

  private listingUrl(order: string, page: number): string {
    const url = new URL(`${this.baseUrl}/manga`);
    url.searchParams.set('lang', LANG);
    url.searchParams.set('order', order);
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('article.group').each((_, el) => {
      const link = $(el).find('a[href^="/manga/"]').first();
      const href = link.attr('href') || '';
      const slug = href.split('/').filter(Boolean).join('/');
      if (!slug) return;
      const img = $(el).find('img[alt]').first();
      const title = img.attr('alt') || slug.split('/').pop() || '';
      mangas.push({
        title,
        url: this.absUrl(`/${slug}`),
        thumbnailUrl: this.absUrl(img.attr('src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('link[rel=next]').length > 0 };
  }

  private async fetchSeries(slug: string): Promise<SeriesInfo | undefined> {
    const res = await this.get(`/api/series?lang=${LANG}&slugs=${encodeURIComponent(slug)}`);
    return (res.data as SeriesInfo[])[0];
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = mangaUrl.split('/').filter(Boolean).pop();
    if (!slug) throw new Error(`Invalid manga url: ${mangaUrl}`);
    const series = await this.fetchSeries(slug);
    if (!series) throw new Error('Series not found');
    const status = (series.status || '').toLowerCase();
    const parts: string[] = [];
    if (series.synopsis && series.synopsis.trim()) parts.push(series.synopsis.trim());
    const alts = (series.altTitles || []).map(t => `- ${t}`).join('\n');
    if (alts) parts.push(`Alternative Titles:\n${alts}`);
    const authorParts = [series.author, series.artist]
      .map(t => (t || '').trim())
      .filter(Boolean)
      .join(', ');
    return {
      title: series.title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(series.cover || ''),
      description: parts.join('\n\n') || undefined,
      author: authorParts || undefined,
      genre: (series.genres || []).join(', ') || undefined,
      status:
        status === 'ongoing'
          ? 1
          : status === 'completed'
            ? 0
            : status === 'hiatus'
              ? 3
              : status === 'dropped' || status === 'cancelled'
                ? 2
                : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaUrl.split('/').filter(Boolean).pop();
    if (!slug) return [];
    const series = await this.fetchSeries(slug);
    if (!series) return [];
    const targetLangs = this.lang === 'all' ? [LANG] : [this.lang];
    const chapters: Chapter[] = [];
    for (const ch of series.chapters) {
      const langs = ch.langs || [];
      if (!targetLangs.some(l => langs.includes(l))) continue;
      const number = String(ch.number).replace(/\.0$/, '');
      chapters.push({
        name: `Chapter ${number}`,
        url: this.absUrl(`/manga/${series.slug}/${ch.slug}`),
        chapterNumber: ch.number,
        dateUpload: Date.parse(ch.releasedAt || ch.translatedAt || '') || undefined,
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const html = (await this.get(chapterUrl)).data as string;
    const $ = this.$(html);
    return $('[data-reader-page] img')
      .map((index, el) => ({
        index,
        imageUrl: this.absUrl($(el).attr('src') || ''),
      }))
      .get()
      .filter(page => !!page.imageUrl);
  }
}

export default RawkumameScraper;
