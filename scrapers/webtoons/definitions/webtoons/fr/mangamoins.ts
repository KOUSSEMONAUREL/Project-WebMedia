import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface TrendItem {
    slug: string;
    title: string;
    cover: string;
}

interface TrendResponse {
    data: TrendItem[];
}

interface MangaListItem {
    slug: string;
    title: string;
    picture: string;
}

interface MangaListResponse {
    data: MangaListItem[];
    page: number;
    limit: number;
    total: number;
}

interface MangaDetailsResponse {
    info: {
        title: string;
        author: string;
        description: string;
        status: string;
        cover: string;
    };
    chapters: {
        num: number;
        title: string;
        slug: string;
        time: string;
    }[];
}

interface ScanResponse {
    pagesBaseUrl: string;
    pageNumbers: number[];
}

interface SaltResult {
    salt: string[];
}

export class MangamoinsScraper extends BaseScraper {
    readonly name = 'MangaMoins';
    readonly baseUrl = 'https://mangamoins.com';
    readonly apiUrl = 'https://mangamoins.com/api/v1';
    readonly lang = 'fr';

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiUrl}/trend`);
        const data = res.data as TrendResponse;
        const mangas: Manga[] = data.data.map(item => ({
            title: item.title,
            url: `/manga/${item.slug}`,
            thumbnailUrl: this.absUrl(item.cover),
            lang: this.lang,
        }));
        return { mangas, hasNextPage: false };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiUrl}/mangas`, {
            params: { page: String(page), limit: '20' },
        });
        return this._parseMangaList(res.data);
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiUrl}/explore`, {
            params: { page: String(page), limit: '20', q: query },
        });
        return this._parseMangaList(res.data);
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const slug = mangaUrl.replace('/manga/', '');
        const res = await this.get(`${this.apiUrl}/manga`, {
            params: { manga: slug },
        });
        const data = res.data as MangaDetailsResponse;
        return {
            title: data.info.title,
            url: mangaUrl,
            thumbnailUrl: this.absUrl(data.info.cover),
            lang: this.lang,
            author: data.info.author,
            description: data.info.description,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const slug = mangaUrl.replace('/manga/', '');
        const res = await this.get(`${this.apiUrl}/manga`, {
            params: { manga: slug },
        });
        const data = res.data as MangaDetailsResponse;
        return data.chapters.map(ch => ({
            name: ch.title || `Chapter ${ch.num}`,
            url: `/manga/${slug}/${ch.slug}`,
            chapterNumber: ch.num,
            dateUpload: new Date(ch.time).getTime(),
        }));
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const slug = chapterUrl.split('/').slice(-2).join('/');
        const res = await this.post(`${this.apiUrl}/scan`, { slug }, {
            headers: { 'Content-Type': 'application/json' },
        });
        const scan = res.data as ScanResponse;
        const salts = await this._extractSalts();
        let baseUrl = scan.pagesBaseUrl;
        for (const s of salts) {
            baseUrl = baseUrl.replace(s, '');
        }
        return scan.pageNumbers.map((num, idx) => ({
            index: idx,
            imageUrl: `${baseUrl}${String(num).padStart(3, '0')}.webp`,
        }));
    }

    private async _extractSalts(): Promise<string[]> {
        const res = await this.get('/includes/components/js/reader.js');
        const js = res.data as string;
        const regex = /var\s+([a-zA-Z]+)\s*=\s*'[^']*'/g;
        const salts: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = regex.exec(js)) !== null) {
            salts.push(match[1]);
        }
        return salts;
    }

    private _parseMangaList(data: MangaListResponse): SearchResult {
        const mangas = data.data.map(item => ({
            title: item.title,
            url: `/manga/${item.slug}`,
            thumbnailUrl: this.absUrl(item.picture),
            lang: this.lang,
        }));
        const hasNextPage = data.page * data.limit < data.total;
        return { mangas, hasNextPage };
    }
}
