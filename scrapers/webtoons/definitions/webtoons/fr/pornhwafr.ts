import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class PornhwafrScraper extends BaseScraper {
    readonly name = 'PornhwaFR';
    readonly baseUrl = 'https://pornhwa.fr';
    readonly lang = 'fr';
    readonly mangaUrlDirectory = '/catalogue';

    private _parseMangaList(html: string): Manga[] {
        const $ = this.$(html);
        const mangas: Manga[] = [];
        $('.cate-child, .page-item-detail, .item-thumb').each((_, el) => {
            const $el = $(el);
            const title = $el.find('.h4 a, .post-title a, h3 a').first().text().trim() ||
                          $el.attr('title') || '';
            const url = $el.find('a').first().attr('href') || '';
            const thumbnailUrl = $el.find('img').first().attr('src') ||
                                 $el.find('img').first().attr('data-src') || '';
            if (title && url) {
                mangas.push({ title, url, thumbnailUrl, lang: this.lang });
            }
        });
        return mangas;
    }

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.mangaUrlDirectory}/?page=${page}&order=popular`);
        const mangas = this._parseMangaList(res.data);
        const $ = this.$(res.data);
        const hasNextPage = $('.next, .next.page-numbers').length > 0;
        return { mangas, hasNextPage };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.mangaUrlDirectory}/?page=${page}&order=update`);
        const mangas = this._parseMangaList(res.data);
        const $ = this.$(res.data);
        const hasNextPage = $('.next, .next.page-numbers').length > 0;
        return { mangas, hasNextPage };
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get(`/page/${page}/?s=${encodeURIComponent(query)}`);
        const mangas = this._parseMangaList(res.data);
        const $ = this.$(res.data);
        const hasNextPage = $('.next, .next.page-numbers').length > 0;
        return { mangas, hasNextPage };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const res = await this.get(mangaUrl);
        const $ = this.$(res.data);
        const title = $('.post-title h1').first().text().trim() ||
                      $('h1.entry-title').first().text().trim();
        const thumbnailUrl = $('.summary_image img').first().attr('src') || '';
        const author = $('.infotable tr:contains(Auteur) td:last-child').text().trim() ||
                       $('.author-content a').first().text().trim();
        const description = $('.description-summary .summary__content p').first().text().trim() ||
                            $('.entry-content p').first().text().trim();
        const altNameText = $('.infotable tr:contains(Nom alternatif) td:last-child').text().trim();
        const altName = altNameText ? altNameText.replace(/^Nom alternatif\s*:\s*/i, '') : undefined;
        return {
            title, url: mangaUrl, thumbnailUrl, lang: this.lang,
            author, description,
            ...(altName ? { altName } : {}),
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const res = await this.get(`${mangaUrl}/ajax/chapters`, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const $ = this.$(res.data);
        const chapters: Chapter[] = [];
        $('.wp-manga-chapter a').each((_, el) => {
            const url = $(el).attr('href') || '';
            const name = $(el).text().trim();
            const dateText = $(el).parent().find('.chapter-release-date i').text().trim() ||
                             $(el).closest('li').find('.chapter-release-date').text().trim();
            let dateUpload: number | undefined;
            if (dateText) {
                dateUpload = new Date(dateText).getTime();
            }
            if (name && url) {
                chapters.push({ name, url, dateUpload: dateUpload && !isNaN(dateUpload) ? dateUpload : undefined });
            }
        });
        return chapters.reverse();
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const res = await this.get(chapterUrl);
        const $ = this.$(res.data);
        const pages: Page[] = [];
        $('.reading-content img').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src') || '';
            if (src) {
                pages.push({ index: i, imageUrl: this.absUrl(src) });
            }
        });
        return pages;
    }
}
