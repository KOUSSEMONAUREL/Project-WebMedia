import { MadaraScraper } from '../../../engine/madara';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface HentaiImage {
  src: string;
}

interface HentaiPageData {
  images: HentaiImage[];
}

export class Hentai4freeScraper extends MadaraScraper {
  constructor() { super('Hentai4Free', 'https://hentai4free.net', 'en'); }
  protected override readonly mangaSubString = 'hentai';

  public override async getPopular(page = 1): Promise<SearchResult> {
    return this.ajaxList(page, { metaKey: '_wp_manga_views' });
  }

  public override async getLatest(page = 1): Promise<SearchResult> {
    return this.ajaxList(page, { metaKey: '_latest_update' });
  }

  public override async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.ajaxList(page, { query });
  }

  private async ajaxList(page: number, opts: { metaKey?: string; query?: string }): Promise<SearchResult> {
    const form = new URLSearchParams();
    form.append('action', 'madara_load_more');
    form.append('page', String(page - 1));
    form.append('template', 'madara-core/content/content-archive');
    form.append('vars[paged]', '1');
    form.append('vars[template]', 'archive');
    form.append('vars[posts_per_page]', '25');
    form.append('vars[post_type]', 'wp-manga');
    form.append('vars[post_status]', 'publish');
    form.append('vars[manga_archives_item_layout]', 'big_thumbnail');
    form.append('vars[meta_query][0][key]', '_wp_manga_chapter_type');
    form.append('vars[meta_query][0][value]', 'manga');
    if (opts.metaKey) {
      form.append('vars[orderby]', 'meta_value_num');
      form.append('vars[meta_key]', opts.metaKey);
      form.append('vars[order]', 'DESC');
    }
    if (opts.query) form.append('vars[s]', opts.query);
    const res = await this.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, form, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const $ = this.$(res.data);
    const mangas: Manga[] = $('.page-item-detail').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('.post-title a').first();
      const href = link.length > 0 ? link.attr('href') || '' : '';
      if (!href) return null;
      const img = $el.find('img').first();
      const thumb = img.length > 0 ? this.imageFromElement(img) : null;
      return {
        title: link.text().trim(),
        url: this.absUrl(href),
        thumbnailUrl: thumb || '',
        lang: this.lang,
      };
    }).filter((m): m is Manga => m !== null);
    return { mangas, hasNextPage: mangas.length === 25 };
  }

  public override async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('section.h4f-oneshot-preview').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('.h4f-preview-reader-btn').first();
      const url = link.length > 0 ? this.absUrl(link.attr('href') || '') : '';
      const name = $el.find('.h4f-preview-title small').first().text().trim() || link.text().trim();
      return { name, url };
    }).filter(ch => ch.url.length > 0);
  }

  public override async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const raw = $('script#h4f-r2-data').first().html() || '';
    if (!raw.trim()) return [];
    const data = JSON.parse(raw) as HentaiPageData;
    return (data.images || [])
      .map((img, index) => ({ index, imageUrl: img.src || '' }))
      .filter(p => p.imageUrl.length > 0);
  }
}
