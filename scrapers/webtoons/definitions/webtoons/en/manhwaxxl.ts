import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';
export class ManhwaxxlScraper extends BaseScraper {
  readonly name = 'Manhwa XXL';
  readonly baseUrl = 'https://hentaitnt.net';
  readonly lang = 'en';
  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/recommended${page > 1 ? `/page/${page}` : ''}`);
    return this.parseMangas(res.data);
  }
  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/latest${page > 1 ? `/page/${page}` : ''}`);
    return this.parseMangas(res.data);
  }
  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = query ? `/?s=${encodeURIComponent(query)}` : '';
    const res = await this.get(url);
    return this.parseMangas(res.data);
  }
  private async parseMangas(html: string): Promise<SearchResult> {
    const $ = this.$(html);
    const mangas: Manga[] = $('.comic-card a').toArray().map(el => {
      const $el = $(el);
      const title = $el.attr('title') || '';
      const url = this.absUrl($el.attr('href') || '');
      const thumbnailUrl = this.absUrl($el.find('img').attr('src') || '');
      return { title, url, thumbnailUrl, lang: 'en' };
    });
    const hasNextPage = $('a[title=Next]').length > 0;
    return { mangas, hasNextPage };
  }
  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const author = $('i[title=Artists] + span a').text() || undefined;
    const description = $('#synopsisText').text() || undefined;
    const genre = $('.genre-item').toArray().map(el => $(el).text()).join(', ');
    return { url: mangaUrl, lang: 'en', author, description };
  }
  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const mangaId = $('#post_manga_id').attr('value');
    if (!mangaId) throw new Error('Failed to get chapter id');
    const formData = new URLSearchParams();
    formData.append('action', 'baka_ajax');
    formData.append('type', 'load_chapters_paginated');
    formData.append('parent_id', mangaId);
    formData.append('per_page', '10000');
    formData.append('order', 'newest_first');
    const ajaxRes = await this.post('/wp-admin/admin-ajax.php', formData, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const dto = JSON.parse(ajaxRes.data);
    const $chapters = this.$(dto.data.html);
    return $chapters.find('.comic-card').toArray().map(el => {
      const $el = $(el);
      const link = $el.find('a');
      const url = this.absUrl(link.attr('href') || '');
      const isVip = $el.find('.fa-crown').length > 0;
      const name = (isVip ? '\uD83D\uDD12 ' : '') + (link.attr('title') || 'Chapter');
      return { name, url };
    }).filter(c => c.url);
  }
  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('.page-image').toArray().map((el, i) => ({
      index: i,
      imageUrl: this.absUrl($(el).attr('src') || ''),
    }));
  }
}
