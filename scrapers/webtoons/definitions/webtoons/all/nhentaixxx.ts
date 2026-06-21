import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class NHentaiXXXScraper extends BaseScraper {
  readonly name = 'NHentai.xxx';
  readonly baseUrl = 'https://nhentai.xxx';
  readonly lang = 'all';
  readonly supportsLatest = true;
  readonly favoritePath = 'favorites';
  readonly idPrefixUri = 'g';

  async getPopular(page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl(`/popular/`, page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl(`/`, page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    const url = this.buildPageUrl(`/search/${encodeURIComponent(query)}/`, page);
    const res = await this.get(url);
    return this.parseListing(res.data);
  }

  private buildPageUrl(base: string, page: number): string {
    const separator = base.endsWith('/') ? '' : '/';
    return page > 1 ? `${base}${separator}page/${page}/` : base;
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('.galleries_box .gallery_item').toArray().map(el => {
      const $el = $(el);
      const a = $el.find('a').first();
      const url = this.absUrl(a.attr('href') || '');
      const img = $el.find('img').first();
      const thumbnailUrl = this.imgAttr(img);
      const title = img.attr('alt') || a.text() || '';
      return { title, url, thumbnailUrl, lang: this.lang };
    });
    const hasNextPage = $('.pagination li.active + li:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const title = $('h1').first().text();
    const thumbnailUrl = this.imgAttr($('.cover img').first());
    const genre = this.getInfo($, 'Tags');
    const author = this.getInfo($, 'Artists');
    const desc = this.getDescription($);
    return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, author, description: desc, genre };
  }

  private getDescription($: ReturnType<typeof this.$>): string {
    const parts: string[] = [];
    for (const tag of ['Parodies', 'Characters', 'Languages', 'Categories', 'Category']) {
      const val = this.getInfo($, tag);
      if (val) parts.push(`${tag}: ${val}`);
    }
    return parts.join('\n\n');
  }

  private getInfo($: ReturnType<typeof this.$>, tag: string): string {
    return $(`.tags:contains(${tag}:) a.tag_btn`).toArray().map(el => {
      const $el = $(el);
      const name = $el.find('.tag_name').first().text().trim();
      const split = $el.find('.split_tag').text().replace('| ', '').trim();
      return [name, split].filter(s => s).join(', ');
    }).filter(s => s).join(', ');
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return [{
      name: 'Chapter',
      url: mangaUrl,
      dateUpload: 0,
      scanlator: this.getInfo($, 'Groups') || undefined,
    }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const json = this.parseJson($);
    if (json) {
      const loadDir = this.inputIdValue($, 'load_dir');
      const loadId = this.inputIdValue($, 'load_id');
      const galleryId = this.inputIdValue($, 'gallery_id');
      const server = this.getServer($);
      const imagesUri = `https://${server}/${loadDir}/${loadId}`;
      const pageUrl = `${this.baseUrl}/g/${galleryId}`;
      const images = JSON.parse(json);
      return Object.entries(images).map(([key, val]) => {
        const ext = String(val).split(',')[0];
        const imageExt = ext === 'p' ? 'png' : ext === 'b' ? 'bmp' : ext === 'g' ? 'gif' : ext === 'w' ? 'webp' : 'jpg';
        return {
          index: parseInt(key),
          imageUrl: `${imagesUri}/${key}.${imageExt}`,
        };
      });
    }
    return this.pageListParseAlternative($);
  }

  private pageListParseAlternative($: ReturnType<typeof this.$>): Page[] {
    const pages = $('.gallery_thumb a').toArray().map(el => {
      const $el = $(el);
      return this.imgAttr($el.find('img').first()) || '';
    }).filter(s => s).map(url => url.replace(/t\.(jpg|jpeg|png|gif|webp|bmp)$/, '.$1'));
    return pages.map((url, idx) => ({
      index: idx,
      imageUrl: url,
    }));
  }

  private inputIdValue($: ReturnType<typeof this.$>, id: string): string {
    return $(`input[id="${id}"]`).attr('value') || '';
  }

  private parseJson($: ReturnType<typeof this.$>): string | null {
    const script = $('script:containsData(parseJSON)').first().text() || '';
    const match = script.match(/\$\.parseJSON\('({"fl":.*?),"th":/);
    return match ? match[1] : null;
  }

  private getServer($: ReturnType<typeof this.$>): string {
    const serverNum = this.inputIdValue($, 'load_server');
    if (serverNum) {
      const domain = new URL(this.baseUrl).host;
      return `i${serverNum}.${domain}`;
    }
    const cover = this.imgAttr($('.cover img').first());
    if (cover) return new URL(cover).host;
    return new URL(this.baseUrl).host;
  }

  private imgAttr($el: cheerio.Cheerio): string {
    if (!$el || !$el.length) return '';
    return this.absUrl(
      $el.attr('data-cfsrc') ||
      $el.attr('data-src') ||
      $el.attr('data-lazy-src') ||
      $el.attr('src') ||
      ''
    );
  }
}
