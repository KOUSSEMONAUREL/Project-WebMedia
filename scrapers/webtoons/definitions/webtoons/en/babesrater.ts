import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class BabesRaterScraper extends BaseScraper {
  override readonly name = 'Babes Rater';
  override readonly baseUrl = 'https://babesrater.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getHottest('girls');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const name = query.trim();
    if (!name) return this.getPopular(page);
    const url = new URL(`${this.baseUrl}/search/searchbyname`);
    url.searchParams.set('name', name);
    const response = await this.get(url.toString());
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('li.picListAll').each((_, el) => {
      const item = $(el);
      const link = item.find('.picListAllName a').first();
      mangas.push({
        title: link.text(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(item.find('img').first().attr('data-src') || ''),
        lang: this.lang,
      });
    });
    const hasNextPage = $('ul.pagination:not(.alphabet) li.active + li a')
      .toArray()
      .some(el => /^\d+$/.test($(el).text().trim()));
    return { mangas, hasNextPage };
  }

  private async getHottest(path: string): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/hottest/${path}`);
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('.hottestLeft ol > li').each((_, el) => {
      const item = $(el);
      const link = item.find('h2 a').first();
      mangas.push({
        title: link.text(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(item.find('.hottestPic img').first().attr('data-src') || ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const absoluteUrl = this.absUrl(mangaUrl);
    const response = await this.get(absoluteUrl);
    const $ = this.$(response.data);
    const title = $('h1 [itemprop=name]').first().text();
    const thumbnailUrl = this.absUrl($('meta[property="og:image"]').attr('content') || '');
    const votesText = $('#bio [itemprop=ratingExplanation]').first().text();
    const votes = /\d+/.exec(votesText)?.[0];
    const rating = $('#rating [itemprop=ratingValue]').first().text();
    const parts: string[] = [];
    if (rating && votes && Number(votes) > 0) parts.push(`Rating: ${rating}/10 (${votes} votes)`);
    const info = $('#nudePictures .numpics').first().text().trim();
    if (info) parts.push(info);
    const stats = $('#bio .person-bio-div tr').toArray().flatMap(row => {
      const cells = $(row).find('td').toArray();
      if (cells.length !== 2) return [];
      return [`- **${$(cells[0]).text().trim()}:** ${$(cells[1]).text().trim()}`];
    });
    if (stats.length > 0) parts.push(`**Bio:**\n${stats.join('\n')}`);
    const aliasText = $('#nudePictures p.alias').first().text();
    const aliases = aliasText.includes(' is also known as ')
      ? (aliasText.split(' is also known as ')[1]?.split(', ') ?? [])
      : [];
    if (aliases.length > 0) parts.push(`**Aliases:** ${aliases.join(', ')}`);
    return {
      url: absoluteUrl,
      title,
      thumbnailUrl,
      description: parts.join('\n\n'),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const absoluteUrl = this.absUrl(mangaUrl);
    const response = await this.get(absoluteUrl);
    const $ = this.$(response.data);
    const chapters: Chapter[] = [];
    $('#galleriesContainer li.galleries a').each((_, el) => {
      const link = $(el);
      chapters.push({
        name: link.text(),
        url: this.absUrl(link.attr('href') || ''),
        scanlator: 'Galleries',
      });
    });
    chapters.push(...this.pictureChapters($, absoluteUrl, 'nudePictures', 'page', 'Nude pictures'));
    chapters.push(...this.pictureChapters($, absoluteUrl, 'hrPictures', 'pageHot', 'HotnessRater pictures'));
    chapters.forEach((chapter, index) => {
      chapter.chapterNumber = index + 1;
    });
    if (chapters.length === 0) chapters.push({ name: 'Gallery', url: absoluteUrl });
    return chapters.reverse();
  }

  private pictureChapters(
    $: ReturnType<typeof this.$>,
    mangaUrl: string,
    section: string,
    pageParameter: string,
    label: string,
  ): Chapter[] {
    const container = $(`#${section}`);
    if (container.find('li').length === 0) return [];
    const pageText = container
      .find('.pagination div')
      .toArray()
      .map(el => $(el).text().trim())
      .find(text => /^Page \d+ of \d+$/.test(text));
    const pageCount = pageText ? Number(pageText.slice(pageText.lastIndexOf(' ') + 1)) : 0;
    if (!pageCount) return [];
    const chapters: Chapter[] = [];
    for (let page = 1; page <= pageCount; page++) {
      const url = new URL(mangaUrl);
      url.searchParams.set(pageParameter, String(page));
      chapters.push({
        name: `${label}, page ${page}`,
        url: url.toString(),
        scanlator: label,
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const url = new URL(this.absUrl(chapterUrl));
    const selector = url.pathname.startsWith('/gallery/')
      ? '.galleryPics img'
      : url.searchParams.has('pageHot')
        ? '#hrPictures li.getMorePartialLiHot a > img'
        : '#nudePictures li.getMorePartialLi a > img';
    return $(selector).toArray().map((el, index) => {
      const raw = this.absUrl($(el).attr('data-src') || '');
      if (!raw) return { index, imageUrl: '' };
      const parsed = new URL(raw);
      return { index, imageUrl: parsed.origin + parsed.pathname };
    });
  }
}
