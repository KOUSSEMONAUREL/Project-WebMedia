import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

export class AstralMangaScraper extends BaseScraper {
    readonly name = 'AstralManga';
    readonly baseUrl = 'https://astral-manga.fr';
    readonly lang = 'fr';

    async getPopular(page = 1): Promise<SearchResult> {
        try {
            const res = await this.get('/api/mangas', {
                params: { page: String(page), pageSize: '12', sortBy: 'views', sortOrder: 'desc' }
            });
            return this._parseMangaApiResponse(res.data);
        } catch {
            return { mangas: [], hasNextPage: false };
        }
    }

    async getLatest(page = 1): Promise<SearchResult> {
        try {
            const res = await this.get('/api/mangas', {
                params: { page: String(page), pageSize: '12', sortBy: 'createdAt', sortOrder: 'desc' }
            });
            return this._parseMangaApiResponse(res.data);
        } catch {
            return { mangas: [], hasNextPage: false };
        }
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get('/api/mangas', {
            params: { page: String(page), pageSize: '12', sortBy: 'title', sortOrder: 'asc', query }
        });
        return this._parseMangaApiResponse(res.data);
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        // Le site utilise RSC (Next.js data), on doit fetch le mangaDetailsRequest
        const res = await this.get(mangaUrl, { headers: { 'RSC': '1' } });
        const rscBody = res.data;
        
        // Extraction du JSON embarqué (logique portage du Kotlin)
        const mangaUuid = mangaUrl.split('/')[2]; // Simplifié
        return this._parseChapters(rscBody, mangaUuid);
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const res = await this.get(chapterUrl);
        const $ = this.$(res.data);
        
        const pages: Page[] = [];
        // Support des images en dur
        $('img[alt^="Page"]').each((i, el) => {
            pages.push({ imageUrl: this.absUrl($(el).attr('src') || ''), index: i });
        });
        return pages;
    }

    private _parseMangaApiResponse(data: any): SearchResult {
        return {
            mangas: data.mangas.map((m: any) => ({
                title: m.title,
                url: `/manga/${m.urlId}`,
                thumbnailUrl: m.coverUrl,
                lang: this.lang
            })),
            hasNextPage: data.mangas.length >= 12
        };
    }

    private _parseChapters(rscBody: string, mangaUuid: string): Chapter[] {
        // Portage simplifié de la logique de parsing Next.js
        // Dans une implémentation réelle, on parserait le JSON dans le RSC body
        return []; 
    }
}
