import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const ITEMS_PER_PAGE = 12;
const XRW_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

export const INITIAL_CATEGORIES: Record<string, string> = {
  'None': '',
  'China & Taiwan': 'albums/categories/china-taiwan',
  'South Korea': 'albums/categories/korea',
  'JAV & AV Models': 'albums/categories/jav',
  'Gravure Idols': 'albums/categories/gravure-idols',
  'Amateur': 'albums/categories/amateur3',
  'Western Girls': 'albums/categories/western-girls',
  'Southeast Asia': 'albums/categories/southeast-asia',
  'JAV Amateur': 'albums/categories/jav-amateur',
  'Cosplay': 'albums/tags/cosplay',
  'Japanese': 'albums/tags/japanese',
  'Japan': 'albums/tags/japan',
  'Photobook': 'albums/tags/photobook',
  'Friday': 'albums/tags/friday',
  'Korean': 'albums/tags/korean',
  'Friday Digital Photobook': 'albums/tags/friday-digital-photobook',
  'Graphis': 'albums/tags/graphis',
  'Lovepop': 'albums/tags/lovepop',
  'Fantia': 'albums/tags/fantia',
  'Gals': 'albums/tags/gals',
  'Friday Gold': 'albums/tags/friday-gold',
  'Girlz-High': 'albums/tags/girlz-high',
  'Xiuren': 'albums/tags/xiuren',
  'Weekly Playboy': 'albums/tags/weekly-playboy',
  'Leehee Express': 'albums/tags/leehee-express',
  'Flash': 'albums/tags/flash',
  'Young Magazine': 'albums/tags/young-magazine',
  'Bunny': 'albums/tags/bunny',
  'Nude': 'albums/tags/nude',
  'JVID': 'albums/tags/jvid',
  'Maid': 'albums/tags/maid',
  'Artgravia': 'albums/tags/artgravia',
  'Onlyfans': 'albums/tags/onlyfans',
  'Young Jump': 'albums/tags/young-jump',
  'Young Champion': 'albums/tags/young-champion',
  'Big Comic Spirits': 'albums/tags/big-comic-spirits',
  'Uniform': 'albums/tags/uniform',
  'Shonen Magazine': 'albums/tags/shonen-magazine',
  'Xiaoyu': 'albums/tags/xiaoyu',
  'Summertime': 'albums/tags/summertime',
  'Patreon': 'albums/tags/patreon',
  'Swimsuit': 'albums/tags/swimsuit',
  'Tiny Body': 'albums/tags/tiny-body',
  'Yuuhui': 'albums/tags/yuuhui',
  'Yanmaga Web': 'albums/tags/yanmaga-web',
  'Shonen Sunday': 'albums/tags/shonen-sunday',
  'Bejean On Line': 'albums/tags/bejean-on-line',
  'Djawa': 'albums/tags/djawa',
  'Pure Media': 'albums/tags/pure-media',
  'School': 'albums/tags/school',
  'Night': 'albums/tags/night',
  'Espacia Korea': 'albums/tags/espacia-korea',
  'Bikini': 'albums/tags/bikini',
  'Black': 'albums/tags/black',
  'Bluecake': 'albums/tags/bluecake',
  'Teen': 'albums/tags/teen',
  'Loozy': 'albums/tags/loozy',
  'Allgravure': 'albums/tags/allgravure',
  'Girls': 'albums/tags/girls',
};

export class XAsiatAlbumsScraper extends BaseScraper {
  readonly name = 'XAsiat Albums';
  readonly baseUrl = 'https://www.xasiat.com';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchQuery('albums/', 'list_albums_common_albums_list', page, { sort_by: 'album_viewed_week' });
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchQuery('albums/', 'list_albums_common_albums_list', page, { sort_by: 'post_date' });
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('http://') || query.startsWith('https://')) {
      const response = await this.get(query, { headers: XRW_HEADERS });
      return this.parseAlbumList(response.data);
    }
    if (query.trim() !== '') {
      return this.searchQuery('search/search/', 'list_albums_albums_list_search_result', page, { q: query });
    }
    return this.getLatest(page);
  }

  private async searchQuery(path: string, blockId: string, page: number, params: Record<string, string>): Promise<SearchResult> {
    const offset = (page - 1) * ITEMS_PER_PAGE + 1;
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`);
    url.searchParams.set('mode', 'async');
    url.searchParams.set('function', 'get_block');
    url.searchParams.set('block_id', blockId);
    url.searchParams.set('from', String(offset));
    if (blockId.includes('search')) {
      url.searchParams.set('from_albums', String(offset));
    }
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('_', String(Date.now()));
    const response = await this.get(url.toString(), { headers: XRW_HEADERS });
    return this.parseAlbumList(response.data);
  }

  private parseAlbumList(html: string): SearchResult {
    const $ = this.$(html);
    const seen = new Set<string>();
    const mangas: Manga[] = [];
    $('.list-albums .item a[href]').each((_, el) => {
      const link = $(el);
      const mangaUrl = this.absUrl(link.attr('href') || '');
      if (!mangaUrl || !mangaUrl.includes('/albums/')) return;
      const url = mangaUrl.startsWith(this.baseUrl) ? mangaUrl.slice(this.baseUrl.length) : mangaUrl;
      if (seen.has(url)) return;
      seen.add(url);
      const img = link.find('img').first();
      const title = (link.attr('title') || '').trim() || (img.attr('alt') || '').trim();
      const thumbSrc = img.attr('data-original') || img.attr('src') || '';
      mangas.push({
        url,
        title,
        thumbnailUrl: thumbSrc ? this.absUrl(thumbSrc) : '',
        lang: this.lang,
        status: 2,
      });
    });
    const hasNextPage =
      $('.pagination a[href], .pages a[href], .pager a[href]')
        .toArray()
        .some(a => ($(a).text() || '').toLowerCase().includes('next')) ||
      mangas.length >= ITEMS_PER_PAGE;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl, { headers: XRW_HEADERS });
    const $ = this.$(response.data);
    const title = $('.entry-title').first().text().trim() || $('.headline h1').first().text().trim() || undefined;
    const genre = $('.info-content a')
      .toArray()
      .map(a => ({ text: $(a).text().trim(), href: this.absUrl($(a).attr('href') || '') }))
      .filter(a => a.text !== '' && a.href.includes('/albums/'))
      .map(a => a.text)
      .join(', ') || undefined;
    return {
      title,
      description: $('meta[property="og:description"]').attr('content') || undefined,
      thumbnailUrl: $('meta[property="og:image"]').attr('content') || '',
      genre,
      status: 2,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return [{ url: mangaUrl, name: 'Photobook', dateUpload: Date.now() }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl, { headers: XRW_HEADERS });
    const $ = this.$(response.data);
    const seen = new Set<string>();
    const imageUrls: string[] = [];
    $('a.item[href], a[href*="/get_image/"]').each((_, el) => {
      const imageUrl = this.absUrl($(el).attr('href') || '');
      if (!imageUrl || !imageUrl.includes('/get_image/') || seen.has(imageUrl)) return;
      seen.add(imageUrl);
      imageUrls.push(imageUrl);
    });
    return imageUrls.map((imageUrl, index) => ({ index, imageUrl }));
  }
}
