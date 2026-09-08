import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface TapasRankingItem {
  seriesId: number;
  title: string;
  description?: string;
  authorList?: string[];
  genreList?: { value: string }[];
  assetProperty?: {
    thumbnailImage?: { path: string };
    bookCoverImage?: { path: string };
  };
}

interface TapasRankingResponse {
  data: {
    items: TapasRankingItem[];
  };
  meta?: unknown;
}

export class TapasticScraper extends BaseScraper {
  readonly name = 'Tapas';
  readonly baseUrl = 'https://tapas.io';
  readonly lang = 'en';
  private readonly apiUrl = 'https://story-api.tapas.io';

  private mangaFromRankingItem(item: TapasRankingItem): Manga {
    const id = item.seriesId.toString();
    const thumbnailUrl =
      item.assetProperty?.thumbnailImage?.path ||
      item.assetProperty?.bookCoverImage?.path ||
      '';
    const genre = (item.genreList || []).map(g => g.value).join(', ') || undefined;
    return {
      title: item.title,
      url: `/series/${id}`,
      thumbnailUrl,
      lang: this.lang,
      description: item.description,
      author: item.authorList?.join(', '),
      genre,
    };
  }

  private async parseRanking(url: string): Promise<SearchResult> {
    const res = await this.get(url, {
      headers: {
        Referer: 'https://m.tapas.io',
        Accept: 'application/json',
      },
    });
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const dto = data as TapasRankingResponse;
    const items = dto?.data?.items || [];
    const mangas = items.map(i => this.mangaFromRankingItem(i));
    // API paginates with size 25, hasNext if we got 25
    const hasNextPage = items.length === 25;
    return { mangas, hasNextPage };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const url =
      `${this.apiUrl}/cosmos/api/v1/landing/ranking` +
      `?category_type=COMIC&subtab_id=17&size=25&page=${page - 1}`;
    return this.parseRanking(url);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url =
      `${this.apiUrl}/cosmos/api/v1/landing/genre` +
      `?category_type=COMIC&sort_option=NEWEST_EPISODE&subtab_id=17&pageSize=25&page=${page - 1}`;
    return this.parseRanking(url);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/search?pageNumber=${page}&q=${encodeURIComponent(query)}&t=COMICS`;
    const res = await this.get(url, { headers: { Referer: 'https://m.tapas.io' } });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.search-item-wrap').each((_, el) => {
      const $el = $(el);
      const title =
        $el.find('.item__thumb img').first().attr('alt')?.trim() ||
        $el.find('.title-section .title a').first().text().trim();
      if (!title) return;
      const thumb =
        $el.find('.item__thumb img, .thumb-wrap img').first().attr('src') || '';
      const dataId =
        $el.find('.item__thumb a, .title-section .title a').first().attr('data-series-id') || '';
      if (!dataId) return;
      const url = `/series/${dataId}`;
      const desc = $el.find('.desc.force.mbm').first().text().trim() || undefined;
      mangas.push({ title, url, thumbnailUrl: this.absUrl(thumb), lang: this.lang, description: desc });
    });
    const hasNextPage = $('a[class*=paging__button--next]').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const infoUrl = mangaUrl.endsWith('/info') ? this.absUrl(mangaUrl) : `${this.absUrl(mangaUrl)}/info`;
    const res = await this.get(infoUrl, { headers: { Referer: 'https://m.tapas.io' } });
    const $ = this.$(res.data);
    const title = $('.info__right .title').first().text().trim();
    if (!title) throw new Error('Title not found');
    const thumbnailUrl = $('.thumb.js-thumbnail img').first().attr('src') || '';
    const descBody = $('.description__body').first().text().trim();
    const colophon = $('.colophon').first().text().trim();
    const description = [descBody, colophon].filter(Boolean).join('\n\n') || undefined;
    const genre = $('.genre-btn').toArray().map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined;
    const author = $('.creator-section .name').toArray().map(el => $(el).text().trim()).join(', ') || undefined;
    const scheduleText = $('.schedule-ico:has(.sp-ico-updated-line-pwt) + .schedule-label').first().text().trim();
    let status: 0 | 1 | 3 | undefined;
    if (scheduleText) {
      const low = scheduleText.toLowerCase();
      if (low.includes('updates')) status = 1;
      else if (low.includes('completed')) status = 0;
      else status = 3;
    }
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      lang: this.lang,
      description,
      genre,
      author,
      status,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    // Upstream: paginated episodes at /series/<id>/episodes?page=N
    const cleanPath = new URL(this.absUrl(mangaUrl)).pathname.replace(/\/info\/?$/, '');
    const episodesUrlBase = `${this.baseUrl}${cleanPath}/episodes`;
    const chapters: Chapter[] = [];
    let page = 1;
    let hasNext = true;
    while (hasNext) {
      const url = `${episodesUrlBase}?page=${page}&sort=NEWEST&since=0&large=true&last_access=0`;
      const res = await this.get(url, { headers: { Referer: this.absUrl(mangaUrl) } });
      let data: unknown = res.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { data = {}; }
      }
      const json = data as { data?: { pagination?: { has_next?: boolean }; body?: string } };
      const body = json?.data?.body || (typeof res.data === 'string' ? res.data : '');
      const paginationHasNext = json?.data?.pagination?.has_next ?? false;
      // Body is HTML fragment with <li><a href="/episode/123" ...>
      const $frag = this.$(`<ul>${body}</ul>`);
      $frag('a[href*="/episode/"]').each((_, el) => {
        const $a = $frag(el);
        // The anchor itself may be the element OR inside
        const href = $a.attr('href') || $frag(el).find('a').attr('href') || '';
        // Alternative: if el is <a> directly
        const directHref = $frag(el).attr('href');
        const finalHref = href || directHref || '';
        if (!finalHref) return;
        const scene = $a.find('.scene').text().trim() || $a.attr('data-scene-number') || '';
        const titleText = $a.find('.title__body').text().trim() || $a.text().trim();
        const name = titleText ? `${scene ? scene + ' - ' : ''}${titleText}` : scene || `Episode`;
        // Detect locked/scheduled via overlay - but include anyway (like upstream showLockedPref=true)
        const url = finalHref.startsWith('http') ? finalHref : this.absUrl(finalHref);
        // Deduplicate
        if (chapters.some(c => c.url === url)) return;
        chapters.push({ name: name || `Episode ${page}`, url });
      });
      // Fallback: if JSON body empty but res.data is HTML full page
      if (chapters.length === 0 && typeof res.data === 'string' && res.data.includes('episode-list')) {
        const $ = this.$(res.data);
        $('a[href*="/episode/"]').each((_, el) => {
          const $a = $(el);
          const href = $a.attr('href');
          if (!href) return;
          const name = $a.find('.scene').text().trim() || $a.text().trim() || 'Episode';
          const url = this.absUrl(href);
          if (!chapters.some(c => c.url === url)) chapters.push({ name, url });
        });
      }
      hasNext = paginationHasNext && chapters.length > 0;
      if (!paginationHasNext) break;
      page++;
      if (page > 5) break; // safety cap
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl), { headers: { Referer: 'https://m.tapas.io' } });
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('img.content__img').each((i, el) => {
      const $img = $(el);
      const src = $img.attr('data-src') || $img.attr('src') || $img.attr('abs:data-src') || '';
      if (!src) return;
      const imageUrl = src.startsWith('http') ? src : this.absUrl(src);
      pages.push({ index: pages.length, imageUrl });
    });
    if (pages.length === 0) throw new Error('Chapter locked or no images found');
    return pages;
  }
}
