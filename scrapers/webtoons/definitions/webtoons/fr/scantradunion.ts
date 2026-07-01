import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class ScantradunionScraper extends BaseScraper {
    readonly name = 'ScantradUnion';
    readonly baseUrl = 'https://scantrad-union.com';
    readonly lang = 'fr';

    private _parsePopularList(html: string): Manga[] {
        const $ = this.$(html);
        const mangas: Manga[] = [];
        $('.index-top3-a').each((_, el) => {
            const $el = $(el);
            const title = $el.find('.index-top3-title').text().trim();
            const href = $el.attr('href') || '';
            const style = $el.find('.index-top3-bg').attr('style') || '';
            const bgMatch = style.match(/url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/);
            const thumbnailUrl = bgMatch ? bgMatch[1] : '';
            if (title && href) {
                mangas.push({ title, url: href, thumbnailUrl: this.absUrl(thumbnailUrl), lang: this.lang });
            }
        });
        return mangas;
    }

    private _parseLatestList(html: string): Manga[] {
        const $ = this.$(html);
        const mangas: Manga[] = [];
        $('.dernieresmaj .colonne').each((_, el) => {
            const $el = $(el);
            const a = $el.find('a.text-truncate').first();
            const href = a.attr('href') || '';
            const title = a.text().trim();
            const thumbnailUrl = $el.find('img.attachment-thumbnail').attr('src') ||
                                 $el.find('img').first().attr('src') || '';
            if (title && href) {
                mangas.push({ title, url: href, thumbnailUrl: this.absUrl(thumbnailUrl), lang: this.lang });
            }
        });
        return mangas;
    }

    private _parseSearchList(html: string): Manga[] {
        const $ = this.$(html);
        const mangas: Manga[] = [];
        if ($('.projet-description').length > 0) {
            const title = $('.projet-description h2').first().text().trim();
            const thumbnailUrl = $('.projet-image img').first().attr('src') || '';
            const url = $('link[rel=canonical]').attr('href') || '';
            if (title && url) {
                mangas.push({ title, url, thumbnailUrl: this.absUrl(thumbnailUrl), lang: this.lang });
            }
            return mangas;
        }
        $('article.post-outer').each((_, el) => {
            const $el = $(el);
            const a = $el.find('a.index-post-header-a').first();
            const href = a.attr('href') || '';
            const title = a.text().trim();
            const thumbnailUrl = $el.find('img.wp-post-image').attr('src') || '';
            if (title && href) {
                mangas.push({ title, url: href, thumbnailUrl: this.absUrl(thumbnailUrl), lang: this.lang });
            }
        });
        return mangas;
    }

    async getPopular(_page = 1): Promise<SearchResult> {
        const res = await this.get('/projets/');
        const mangas = this._parsePopularList(res.data);
        return { mangas, hasNextPage: false };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        if (page > 1) return { mangas: [], hasNextPage: false };
        const res = await this.get('/');
        const mangas = this._parseLatestList(res.data);
        return { mangas, hasNextPage: false };
    }

    async getSearch(query: string, _page = 1): Promise<SearchResult> {
        const res = await this.get('/', {
            params: {
                s: query,
                asp_active: '1',
                p_asid: '1',
                p_asp_data: '1',
            },
        });
        const mangas = this._parseSearchList(res.data);
        return { mangas, hasNextPage: false };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const res = await this.get(mangaUrl);
        const $ = this.$(res.data);
        const title = $('.projet-description h2').first().text().trim() ||
                      $('h1').first().text().trim();
        const thumbnailUrl = $('.projet-image img').first().attr('src') ||
                             $('meta[property="og:image"]').attr('content') || '';
        const description = $('.sContent').text().trim() ||
                            $('meta[name="description"]').attr('content') || '';
        const author = $('div.project-details a[href*="auteur"]').text().trim() || undefined;
        const statusLabels = $('.label.label-primary');
        let status: number | undefined;
        if (statusLabels.length >= 3) {
            const statusText = $(statusLabels[2]).text().trim();
            status = statusText === 'En cours' ? 1 : statusText === 'Terminé' ? 0 : undefined;
        }
        return {
            title, url: mangaUrl, thumbnailUrl: this.absUrl(thumbnailUrl), lang: this.lang,
            author, description, status: status as 0 | 1 | 2 | 3 | undefined,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const res = await this.get(mangaUrl);
        const $ = this.$(res.data);
        const chapters: Chapter[] = [];
        $('.links-projects li').each((_, el) => {
            const $el = $(el);
            const number = $el.find('.chapter-number').text().trim();
            const name = $el.find('.chapter-name').text().trim();
            const a = $el.find('a.btnlel[href*="https://scantrad-union.com/read/"]').first();
            const href = a.attr('href') || '';
            const dateText = $el.find('.name-chapter').text().trim();
            let dateUpload: number | undefined;
            if (dateText && /^\d{2}-\d{2}-\d{4}$/.test(dateText)) {
                const [day, month, year] = dateText.split('-').map(Number);
                dateUpload = new Date(year, month - 1, day).getTime();
            }
            const chapterName = name ? `${number} - ${name}` : number;
            if (chapterName && href) {
                chapters.push({ name: chapterName, url: href, dateUpload });
            }
        });
        return chapters.reverse();
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const res = await this.get(chapterUrl);
        const $ = this.$(res.data);
        const pages: Page[] = [];
        const seen = new Set<string>();
        $('#webtoon a img').each((i, el) => {
            const src = $(el).attr('data-src') || $(el).attr('src') || '';
            if (src && !seen.has(src)) {
                seen.add(src);
                pages.push({ index: i, imageUrl: this.absUrl(src) });
            }
        });
        return pages;
    }
}
