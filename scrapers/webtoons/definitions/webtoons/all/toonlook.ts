import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ToonLookScraper extends BaseScraper {
  readonly name = 'ToonLook';
  readonly baseUrl = 'https://toonlook.com';
  readonly lang = 'all';

  private slugFrom(urlOrSlug: string): string {
    const trimmed = urlOrSlug.split('?')[0];
    const parts = trimmed.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? trimmed;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const path = page > 1 ? `/manhwa/page/${page}/` : '/manhwa/';
    const res = await this.get(path);
    return this.parseListing(res.data as string);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const path = page > 1 ? `/manhwa/page/${page}/?sortby=new` : '/manhwa/?sortby=new';
    const res = await this.get(path);
    return this.parseListing(res.data as string);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('s', query);
    if (page > 1) url.searchParams.set('paged', String(page));
    const res = await this.get(url.toString());
    return this.parseListing(res.data as string);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('.manga-item').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a.manga-item__link').first();
      const href = link.attr('href') || '';
      const slug = href ? this.slugFrom(href) : '';
      const title = link.text().trim();
      const thumb = $el.find('img.manga-item__img-inner').first().attr('src') || '';
      if (title && slug) {
        mangas.push({ title, url: slug, thumbnailUrl: this.absUrl(thumb), lang: this.lang });
      }
    });
    const hasNextPage = $('a.next').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`/manhwa/${slug}/`);
    const $ = this.$(res.data as string);
    const title = $('.manga-titles h1').first().text().trim() || slug;
    const thumbnailUrl = this.absUrl($('img[src*="/img/cover/"]').first().attr('src') || '');
    const description = $('.manga-desc__content').first().text().trim() || undefined;
    const altTitle = $('.manga-titles h2').first().text().trim();
    const genre = $('.manga-genres a').map((_, el) => $(el).text().trim()).get().join(', ') || undefined;
    const author = $('div.items-start a[rel=tag][href*="/manga-author/"] > span:first-child').map((_, el) => $(el).text().trim()).get().join(', ') || undefined;
    const artist = $('div.items-start a[rel=tag][href*="/artist/"] > span:first-child').map((_, el) => $(el).text().trim()).get().join(', ') || undefined;
    const statusText = $('.manga-status[data-status]').first().attr('data-status')?.toLowerCase();
    const status = statusText === 'ongoing' ? 1 : statusText === 'completed' ? 0 : statusText === 'hiatus' ? 3 : statusText === 'dropped' ? 2 : undefined;
    const parts: string[] = [];
    if (description) parts.push(description);
    if (altTitle) parts.push(`Alternative Titles:\n${altTitle.split(', ').map(t => `- ${t}`).join('\n')}`);
    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      description: parts.length > 0 ? parts.join('\n\n') : undefined,
      author,
      artist,
      genre,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFrom(mangaUrl);
    const res = await this.get(`/manhwa/${slug}/`);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];
    const lang = this.lang === 'all' ? 'en' : this.lang;
    $('a.chapter-item').each((_, el) => {
      const $el = $(el);
      const langs = ($el.attr('data-langs') || '').split(' ').filter(Boolean);
      const targetLangs = this.lang === 'all' ? langs : [lang];
      for (const l of targetLangs) {
        if (!langs.includes(l)) continue;
        const title = $el.attr(`data-title-${l}`) || $el.find('.chapter-item__name').first().text().trim();
        const href = $el.attr('href') || '';
        const chapterSlug = href ? this.slugFrom(href) : '';
        if (!chapterSlug) continue;
        const dateText = $el.find('.chapter-item__date').first().text().trim();
        chapters.push({
          name: title,
          url: `${chapterSlug}?lang=${l}`,
          dateUpload: dateText ? Date.parse(dateText) || undefined : undefined,
        });
      }
    });
    return chapters;
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    return [];
  }
}

export default ToonLookScraper;
