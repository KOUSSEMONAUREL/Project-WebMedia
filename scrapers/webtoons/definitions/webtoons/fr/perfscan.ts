import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface PerfScanSeries {
    slug: string;
    title: string;
    thumbnail: string;
}

interface PerfScanSeriesDetails {
    slug: string;
    title: string;
    author: string;
    artist: string;
    description: string;
    statusObject: { name: string };
    seriesGenre: { name: string }[];
    thumbnail: string;
    chapters: {
        index: number;
        title: string;
        createdAt: string;
    }[];
}

interface PerfScanPageList {
    content: { value: string; order: number }[];
}

interface PerfScanResponse<T> {
    data: T;
}

export class PerfscanScraper extends BaseScraper {
    readonly name = 'PerfScan';
    readonly baseUrl = 'https://perf-scan.xyz';
    readonly apiUrl = 'https://api.perf-scan.xyz';
    readonly lang = 'fr';

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiUrl}/api/series`, {
            params: {
                ranking: 'POPULAR',
                rankingType: 'YEARLY',
                type: 'COMIC',
                page: String(page),
                take: '24',
            },
        });
        return this._parseSeriesList(res.data, page);
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiUrl}/api/series`, {
            params: {
                type: 'COMIC',
                page: String(page),
                take: '24',
                latestUpdate: 'true',
            },
        });
        return this._parseSeriesList(res.data, page);
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiUrl}/api/series`, {
            params: {
                type: 'COMIC',
                title: query,
                page: String(page),
                take: '24',
            },
        });
        return this._parseSeriesList(res.data, page);
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const slug = mangaUrl.replace('/manga/', '');
        const res = await this.get(`${this.apiUrl}/api/series/${slug}`);
        const body = res.data as PerfScanResponse<PerfScanSeriesDetails>;
        const s = body.data;
        return {
            title: s.title,
            url: mangaUrl,
            thumbnailUrl: s.thumbnail,
            lang: this.lang,
            author: s.author || s.artist,
            description: s.description,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const slug = mangaUrl.replace('/manga/', '');
        const res = await this.get(`${this.apiUrl}/api/series/${slug}`);
        const body = res.data as PerfScanResponse<PerfScanSeriesDetails>;
        const chapters = body.data.chapters || [];
        return chapters
            .sort((a, b) => b.index - a.index)
            .map(ch => ({
                name: ch.title || `Chapitre ${ch.index}`,
                url: `/manga/${slug}/chapter/${ch.index}`,
                chapterNumber: ch.index,
                dateUpload: new Date(ch.createdAt).getTime(),
            }));
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const parts = chapterUrl.split('/');
        const slug = parts[2];
        const index = parts[4];
        const res = await this.get(`${this.apiUrl}/api/series/${slug}/chapter/${index}`);
        const body = res.data as PerfScanResponse<PerfScanPageList>;
        const content = body.data?.content || [];
        return content
            .sort((a, b) => a.order - b.order)
            .map((item, idx) => ({
                index: idx,
                imageUrl: `${this.apiUrl}/cdn/${item.value}`,
            }));
    }

    private _parseSeriesList(body: PerfScanResponse<PerfScanSeries[]>, page: number): SearchResult {
        const items = body.data || [];
        const mangas = items.map(item => ({
            title: item.title,
            url: `/manga/${item.slug}`,
            thumbnailUrl: item.thumbnail,
            lang: this.lang,
        }));
        const hasNextPage = items.length === 24;
        return { mangas, hasNextPage };
    }
}
