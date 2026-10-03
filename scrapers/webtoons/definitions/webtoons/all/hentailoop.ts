import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface QuickSearchPost {
  id: number;
  title: string;
  thumb: string;
  link: string;
}

interface QuickSearchResponse {
  success: boolean;
  data: { count: number; posts: QuickSearchPost[] };
}

export class HentaiLoopScraper extends BaseScraper {
  readonly name = 'HentaiLoop';
  readonly baseUrl = 'https://hentailoop.com';
  readonly lang = 'all';

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.manga-card a').each((_i, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (!href) return;
      const title = $el.find('.title').first().text().trim();
      const thumb = $el.find('img.attachment-manga_thumb').first();
      const thumbnailUrl = thumb.attr('data-src') ?? thumb.attr('src') ?? '';
      mangas.push({
        title,
        url: this.absUrl(href).replace(this.baseUrl, ''),
        thumbnailUrl: thumbnailUrl ? this.absUrl(thumbnailUrl) : '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('nav.navigation a.next').length > 0 };
  }

  private async getMangaList(directory: string, slug: string | null, sort: string, page: number): Promise<SearchResult> {
    const segments = [directory];
    if (slug) segments.push(slug);
    if (page > 1) segments.push('page', String(page));
    const url = `${this.baseUrl}/${segments.join('/')}/?sortmanga=${sort}`;
    const res = await this.get(url);
    return this.parseMangaList(res.data);
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    return this.getMangaList('manga', null, 'views', page);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    return this.getMangaList('manga', null, 'date', page);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    if (query.trim().length === 0) return this.getPopular(page);
    const form = new URLSearchParams();
    form.append('action', 'nativeSearch');
    form.append('subAction', 'search');
    form.append('query', query.trim());
    const res = await this.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, form, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const data = res.data as QuickSearchResponse;
    const mangas: Manga[] = (data.data?.posts ?? []).map((post) => ({
      title: post.title,
      url: new URL(post.link).pathname,
      thumbnailUrl: post.thumb,
      lang: this.lang,
    }));
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const $ = this.$(res.data);

    const author = $('.manga-term-content a[href*=/artists/]')
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join(', ');

    const genres = [
      ...$('.manga-term-content a[href*=/genres/]')
        .map((_i, el) => $(el).text().trim())
        .get(),
      ...$('.manga-term-content a[href*=/languages/]')
        .map((_i, el) => $(el).text().trim())
        .get(),
      ...$('.manga-term-content a[href*=/tag/]')
        .map((_i, el) => $(el).text().trim())
        .get(),
    ].filter((t) => t.length > 0);

    const descriptionParts: string[] = [];
    const altName = $('.manga-subtitle').first().text().trim();
    if (altName) descriptionParts.push(`Alternative Name: ${altName}`);
    const counter = $('.pre-meta .counter').first().text().trim();
    if (counter) descriptionParts.push(counter);
    const views = $('.pre-meta .manga-views').first().text().trim();
    if (views) descriptionParts.push(views);
    const updated = $('.pre-meta .manga-updated').first().text().trim();
    if (updated) descriptionParts.push(updated);
    const likes = $('.rating-buttons span#likes').first().text().trim();
    if (likes) descriptionParts.push(`Dislikes: ${likes}`);
    if ($('.rating-buttons span#dislikes').length > 0) {
      const dislikes = $('.rating-buttons span#dislikes').first().text().trim();
      if (dislikes) descriptionParts.push(`Likes: ${dislikes}`);
    }
    $('.manga-term-content').each((_i, el) => {
      const $el = $(el);
      if ($el.find('> a[href*=/tag]').length > 0) return;
      const nameEl = $el.prev('.manga-term-name');
      const link = $el.find('a').first();
      if (nameEl.length === 0 || link.length === 0) return;
      descriptionParts.push(`${nameEl.text().trim()}: ${link.text().trim()}`);
    });

    return {
      title: $('.manga-title').first().text().trim() || undefined,
      author: author || undefined,
      artist: author || undefined,
      status: 0,
      thumbnailUrl: $('.manga-thumb img').first().attr('src') ?? undefined,
      description: descriptionParts.length > 0 ? descriptionParts.join('\n') : undefined,
      genre: genres.length > 0 ? [...new Set(genres)].join(', ') : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const abs = this.absUrl(mangaUrl);
    const res = await this.get(abs);
    const $ = this.$(res.data);
    const canonical = $('link[rel=canonical]').first().attr('href');
    const slug = new URL(canonical ?? abs).pathname.split('/').filter(Boolean)[1] ?? '';
    const chapter: Chapter = {
      name: 'Chapter',
      url: `/manga/${slug}/`,
      chapterNumber: 0,
    };
    const dateRaw = this.extractDatePublished(res.data);
    if (dateRaw !== undefined) {
      const ms = Date.parse(dateRaw);
      if (!Number.isNaN(ms)) chapter.dateUpload = ms;
    }
    return [chapter];
  }

  private extractDatePublished(html: string): string | undefined {
    // Transcrit le Kotlin : document.selectFirst(".yoast-schema-graph[type=application/ld+json]")
    // -> data -> @graph -> premier noeud avec datePublished.
    const $ = this.$(html);
    const raw = $('script.yoast-schema-graph[type="application/ld+json"]').first().html();
    if (!raw) return undefined;
    try {
      const data = JSON.parse(raw) as { '@graph'?: Array<{ datePublished?: unknown }> };
      const graph = data['@graph'];
      if (!Array.isArray(graph)) return undefined;
      const node = graph.find((n) => typeof n.datePublished === 'string');
      return typeof node?.datePublished === 'string' ? node.datePublished : undefined;
    } catch {
      return undefined;
    }
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = new URL(this.absUrl(chapterUrl)).pathname.split('/').filter(Boolean)[1] ?? '';
    const url = `${this.baseUrl}/manga/${slug}/read/`;
    const res = await this.get(url);
    const $ = this.$(res.data);

    const bodyClass = $('body').attr('class') ?? '';
    const postIdMatch = /postid-(\d+)/.exec(bodyClass);
    if (postIdMatch) {
      const form = new URLSearchParams();
      form.append('action', 'addview');
      form.append('postID', postIdMatch[1]);
      this.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, form, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      }).catch(() => undefined);
    }

    const pages: Page[] = [];
    $('.gallery-item > dt > img').each((_i, el) => {
      const $el = $(el);
      const src = $el.attr('data-src') || $el.attr('src');
      if (!src) return;
      pages.push({ index: pages.length, imageUrl: this.absUrl(src) });
    });
    return pages;
  }
}
