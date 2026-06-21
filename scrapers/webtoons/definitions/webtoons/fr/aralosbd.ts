import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface AralosManga {
    icon: string;
    title: string;
    id: number;
}

interface AralosSearchResponse {
    error: boolean;
    result_count: number;
    page_count: number;
    mangas: AralosManga[];
}

interface AralosChapter {
    chapter_number: string;
    chapter_title: string;
    chapter_id: number;
    chapter_released: string;
    chapter_release_time: string;
    chapter_translator: string;
}

interface AralosChapterResponse {
    error: boolean;
    chapters: AralosChapter[];
}

interface AralosPageResponse {
    error: boolean;
    links: string[];
}

const PAGE_REGEX = /page:([0-9]+)/;

export class AralosbdScraper extends BaseScraper {
    readonly name = "AralosBD";
    readonly baseUrl = "https://aralosbd.fr";
    readonly lang = "fr";

    async getPopular(page = 1): Promise<SearchResult> {
        const params = new URLSearchParams();
        params.set('s', `sort:allviews;limit:24;-id:3;page:${page - 1};order:desc`);
        const res = await this.get(`/manga/search?${params.toString()}`);
        return this._parseMangaList(res.data, page);
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const params = new URLSearchParams();
        params.set('s', `sort:id;limit:24;-id:3;page:${page - 1};order:desc`);
        const res = await this.get(`/manga/search?${params.toString()}`);
        return this._parseMangaList(res.data, page);
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const params = new URLSearchParams();
        params.set('s', `page:${page - 1};sort:id;order:desc;text:${query}`);
        const res = await this.get(`/manga/search?${params.toString()}`);
        return this._parseMangaList(res.data, page);
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const idMatch = mangaUrl.match(/id=(\d+)/);
        const id = idMatch ? idMatch[1] : mangaUrl.split('/').pop() || '';
        const res = await this.get(`/api?get=manga&id=${id}`);
        const data = res.data as { error: boolean; icon: string; title: string; id: number };
        return {
            title: data.title,
            url: mangaUrl,
            thumbnailUrl: this.absUrl(data.icon || ''),
            lang: this.lang,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const idMatch = mangaUrl.match(/id=(\d+)/);
        const id = idMatch ? idMatch[1] : mangaUrl.split('/').pop() || '';
        const res = await this.get(`/api?get=chapters&manga=${id}`);
        const data = res.data as AralosChapterResponse;
        if (data.error) return [];
        return data.chapters.map((ch) => ({
            name: ch.chapter_title ? `Chapitre ${ch.chapter_number} - ${ch.chapter_title}` : `Chapitre ${ch.chapter_number}`,
            url: `/api?get=pages&chapter=${ch.chapter_id}`,
            chapterNumber: parseFloat(ch.chapter_number),
            scanlator: ch.chapter_translator || undefined,
            dateUpload: ch.chapter_release_time ? new Date(ch.chapter_release_time.replace(' ', 'T')).getTime() : undefined,
        }));
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const idMatch = chapterUrl.match(/chapter=(\d+)/);
        const id = idMatch ? idMatch[1] : chapterUrl.split('=').pop() || '';
        const res = await this.get(`/api?get=pages&chapter=${id}`);
        const data = res.data as AralosPageResponse;
        if (data.error || !data.links) return [];
        return data.links.map((link, index) => ({
            imageUrl: this.absUrl(link),
            index,
        }));
    }

    private _parseMangaList(data: unknown, page: number): SearchResult {
        const dto = data as AralosSearchResponse;
        const mangas: Manga[] = (dto.mangas || []).map((m) => ({
            title: m.title,
            url: `/manga/display?id=${m.id}`,
            thumbnailUrl: this.absUrl(m.icon || ''),
            lang: this.lang,
        }));
        const hasNextPage = dto.page_count > page;
        return { mangas, hasNextPage };
    }
}
