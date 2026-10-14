import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation of keiyoushi `en/hentaisco` (HentaiSco.kt).
 *
 * Rewritten upstream 2026-10-14: the former MadaraNoAjax port is gone,
 * replaced by a KeiSource class with its own endpoints and selectors.
 * - Popular: `/hentai-list?m_orderby=views` (page 1), `/hentai-list/page/N` after
 * - Latest:  `/hentai-list` (+ `/page/N`)
 * - Search:  `/search?q=<query>&page=N` — the site's `/search/page/N/` pager
 *   links 404, hence the query-param page
 * - List:    `article.cover-card` — `a` href `/hentai/<slug>/`, title `h3`, cover `img`
 * - Series:  `/hentai/<slug>/` — `article[data-manga-id]`, title `h1`,
 *   cover `.cover-frame img`, metadata in `dt`/`dd` rows, status in the `p`
 *   preceding the `h1`
 * - Chapter: `ol[data-chapter-list] > li > a`, name `span`, date `time@datetime`
 */
export class HentaiscoScraper extends BaseScraper {
  readonly name = 'HentaiSco';
  readonly baseUrl = 'https://hentaisco.cc';
  readonly lang = 'en';

  private parseList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('article.cover-card').each((_i, el) => {
      const $card = $(el);
      const $link = $card.find('a').first();
      const href = $link.attr('href') || '';
      const segments = new URL(this.absUrl(href)).pathname.split('/').filter(Boolean);
      const slug = segments[1] ?? '';
      if (!slug) return;
      mangas.push({
        url: slug,
        title: $link.find('h3').first().text().trim(),
        thumbnailUrl: this.absUrl($link.find('img').first().attr('src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('nav.pager a[rel=next]').length > 0 };
  }

  private async listPage(path: string, page: number, query = false): Promise<SearchResult> {
    const sep = path.includes('?') ? '&' : '?';
    const pageParam = query ? `${sep}page=${page}` : page > 1 ? `/page/${page}` : '';
    const res = await this.get(`${path}${pageParam}`);
    return this.parseList(res.data as string);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.listPage('/hentai-list?m_orderby=views', page, true);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.listPage('/hentai-list', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (!query.trim()) return this.getPopular(page);
    return this.listPage(`/search?q=${encodeURIComponent(query.trim())}`, page, true);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(`/hentai/${mangaUrl}/`);
    const $ = this.$(res.data as string);
    const $details = $('article[data-manga-id]').first();
    if ($details.length === 0) throw new Error('Could not find manga details');

    const row = (label: string): string | undefined => {
      const values = $details.find('dt')
        .filter((_i, dt) => $(dt).text().includes(label))
        .first().next('dd').find('a')
        .map((_i, a) => $(a).text().trim())
        .get();
      return values.length > 0 ? values.join(', ') : undefined;
    };

    const descriptionParts = $details.find('[data-read-more-body] p, h1 + p')
      .map((_i, p) => $(p).text().trim())
      .get()
      .filter(Boolean);

    const statusText = $details.find('p')
      .filter((_i, p) => $(p).next('h1').length > 0)
      .first().text().toLowerCase();

    return {
      title: $details.find('h1').first().text().trim(),
      url: `/hentai/${mangaUrl}/`,
      thumbnailUrl: this.absUrl($details.find('.cover-frame img').first().attr('src') || ''),
      description: descriptionParts.length > 0 ? descriptionParts.join('\n\n') : undefined,
      author: row('Author'),
      artist: row('Artist'),
      genre: row('Genre') ?? row('Tag'),
      status: statusText.includes('ongoing') ? 1 : statusText.includes('completed') ? 0 : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(`/hentai/${mangaUrl}/`);
    const $ = this.$(res.data as string);
    const chapters: Chapter[] = [];
    $('ol[data-chapter-list] > li > a').each((_i, el) => {
      const $link = $(el);
      const href = $link.attr('href') || '';
      const segments = href.split('/').filter(Boolean).slice(1);
      if (segments.length === 0) return;
      const date = $link.find('time').first().attr('datetime');
      chapters.push({
        name: $link.find('span').first().text().trim(),
        url: segments.join('/'),
        dateUpload: date ? Date.parse(date) || undefined : undefined,
      });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`/hentai/${chapterUrl}/`);
    const $ = this.$(res.data as string);
    return $('[data-reader-pages] img.reader-page')
      .map((_i, img) => ({
        index: _i,
        imageUrl: this.absUrl($(img).attr('src') || ''),
      }))
      .get()
      .filter((p) => p.imageUrl !== '');
  }
}

export default HentaiscoScraper;
