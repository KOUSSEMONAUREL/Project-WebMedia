import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
import type { Cheerio, CheerioAPI } from 'cheerio';

// Transcompilation of keiyoushi src/all/mangadna (MangaDNA.kt, KeiSource HTML theme).
export class MangaDNAScraper extends BaseScraper {
  readonly name = 'MangaDNA';
  readonly baseUrl = 'https://mangadna.com';
  readonly lang = 'all';

  private imgAttr($img: Cheerio<any>): string {
    return this.absUrl(
      $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('src') || '',
    );
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/manga/page/${page}?orderby=rating`);
    return this.mangaListParse(String(res.data));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/manga/page/${page}?orderby=latest`);
    return this.mangaListParse(String(res.data));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (trimmed) {
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('page', String(page));
      const res = await this.get(url.toString());
      return this.mangaListParse(String(res.data));
    }
    const res = await this.get(`/manga/page/${page}`);
    return this.mangaListParse(String(res.data));
  }

  private mangaListParse(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('div.home-item').each((_, card) => {
      const $card = $(card);
      const $link = $card.find('h3.htitle a, .hthumb a').first();
      const href = $link.attr('href');
      if (!href) return;
      // The English catalog skips raw (-raw) duplicates.
      if (href.trim().replace(/\/$/, '').endsWith('-raw')) return;
      const title = ($link.attr('title') || '').trim() || $link.text().trim();
      if (!title) return;
      const img = $card.find('img').first();
      mangas.push({
        title,
        url: href.startsWith('http') ? new URL(href).pathname : href,
        thumbnailUrl: img.length ? this.imgAttr(img) : '',
        lang: this.lang,
      });
    });
    const hasNextPage = $('ul.pagination li.next:not(.disabled) a').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1.entry-title').first().text().trim()
      || $('div.post-title h1, h1').first().text().trim();
    if (!title) throw new Error('Title not found');
    const info = $('div.summary_content_wrap, div.tab-summary').first();
    const scope = info.length ? info : $('body').first();

    const rows = new Map<string, string>();
    scope.find('div.post-content_item').each((_, item) => {
      const $item = $(item);
      const label = ($item.find('.summary-heading').first().text() || '')
        .replace(/:\s*$/, '').trim();
      const value = ($item.find('.summary-content').first().text() || '').trim();
      if (label) rows.set(label, value);
    });

    const pickLinks = (selector: string): string => scope
      .find(selector).toArray()
      .map(el => $(el).text().trim())
      .filter(t => t.length > 0)
      .join(', ') || '';
    const author = pickLinks('div.author-content a');
    const artist = pickLinks('div.artist-content a');
    const genreNames = scope.find('div.genres-content a').toArray()
      .map(el => $(el).text().trim())
      .filter(t => t.length > 0);
    const type = rows.get('Type');
    const genreList = [...genreNames];
    if (type && type !== 'Updating') genreList.push(type);
    const statusRaw = (rows.get('Status') || '').toLowerCase();
    const status = statusRaw === 'ongoing' ? 1
      : ['completed', 'complete', 'finished'].includes(statusRaw) ? 0
      : ['hiatus', 'on hiatus', 'on hold'].includes(statusRaw) ? 3
      : ['cancelled', 'canceled', 'dropped'].includes(statusRaw) ? 2
      : undefined;

    const thumbnailUrl = scope.find('div.summary_image img').first().length
      ? this.imgAttr(scope.find('div.summary_image img').first())
      : this.absUrl($('meta[property="og:image"]').first().attr('content') || '');
    const description = this.buildDescription($, scope, rows);

    return {
      title,
      url: mangaUrl,
      thumbnailUrl,
      description,
      author: author && author !== 'Updating' ? author : undefined,
      artist: artist && artist !== 'Updating' ? artist : undefined,
      genre: [...new Set(genreList)].join(', ') || undefined,
      status,
      lang: this.lang,
    };
  }

  private buildDescription(
    $: CheerioAPI,
    scope: Cheerio<any>,
    rows: Map<string, string>,
  ): string | undefined {
    const parts: string[] = [];
    const synopsis = ($('meta[property="og:description"]').first().attr('content') || '').trim()
      || $('div.summary__content, div.dsct, div.manga-content p').first().text().trim();
    if (synopsis) parts.push(synopsis);
    const alternative = rows.get('Alternative');
    if (alternative && alternative !== 'Updating') parts.push(`Alternative: ${alternative}`);
    const release = rows.get('Release');
    if (release) parts.push(`Released: ${release}`);
    const rating = scope.find('#averagerate').first().text().trim();
    if (rating) {
      const best = scope.find('[property="bestRating"]').first().text().trim() || '5';
      const votes = scope.find('#countrate').first().text().trim();
      parts.push(votes ? `Rating: ${rating} / ${best} (${votes} votes)` : `Rating: ${rating} / ${best}`);
    }
    return parts.join('\n\n') || undefined;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('ul.row-content-chapter li.a-h').toArray().map(el => {
      const $li = $(el);
      const $link = $li.find('a.chapter-name, a').first();
      const href = $link.attr('href') || '';
      const $time = $li.find('.chapter-time').first();
      const raw = ($time.attr('title') || '').trim() || $time.text().trim();
      const parsed = raw ? Date.parse(raw) : NaN;
      return {
        name: $link.text().trim(),
        url: href.startsWith('http') ? new URL(href).pathname : href,
        dateUpload: Number.isNaN(parsed) ? undefined : parsed,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.read-content img').toArray().map((el, index) => ({
      index,
      imageUrl: this.imgAttr($(el)),
    }));
  }
}
