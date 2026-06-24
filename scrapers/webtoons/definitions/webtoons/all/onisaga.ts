import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class OnisagaScraper extends BaseScraper {
    readonly name = 'OniSaga';
    readonly baseUrl = 'https://onisaga.com';
    readonly lang = 'all';

    async getPopular(_page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.baseUrl}/browse`, {
            params: { sort: 'view', platform: 'MANGA' },
            headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        });
        if (typeof res.data === 'object') {
            const items = (res.data as any).manga ?? (res.data as any).series ?? [];
            const mangas = items.map((item: any) => ({
                title: item.title ?? '',
                url: item.url ?? item.slug ?? '',
                thumbnailUrl: item.cover ?? item.thumbnail ?? item.coverImage ?? '',
                lang: this.lang,
            }));
            return { mangas, hasNextPage: false };
        }
        return { mangas: [], hasNextPage: false };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        return this.getPopular(page);
    }

    async getSearch(_query: string, _page = 1): Promise<SearchResult> {
        return { mangas: [], hasNextPage: false };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        try {
            const res = await this.get(mangaUrl);
            const $ = this.$(res.data as string);
            return {
                title: $('h1').first().text() || '',
                url: mangaUrl,
                thumbnailUrl: this.absUrl($('img[src*="cover"], img.cover').first().attr('src') || ''),
                description: $('div:contains(Synopsis), div:contains(Description), p.description').first().text().trim() || undefined,
                lang: this.lang,
            };
        } catch {
            return { url: mangaUrl, lang: this.lang };
        }
    }

    async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
        return [];
    }

    async getPageList(_chapterUrl: string): Promise<Page[]> {
        return [];
    }
}
