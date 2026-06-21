import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface BigSoloSeriesItem {
    title: string;
    icon: string;
    slug: string;
}

interface BigSoloSeriesResponse {
    reco: BigSoloSeriesItem[];
    series: BigSoloSeriesItem[];
    os: BigSoloSeriesItem[];
}

interface BigSoloChapter {
    title: string;
    timestamp: number;
    teams: string[];
    licencied: boolean;
    source: string;
    volume: number;
}

interface BigSoloDetailResponse {
    title: string;
    icon: string;
    slug: string;
    synopsis: string;
    author: string;
    chapters: { [key: string]: BigSoloChapter };
}

interface BigSoloPageResponse {
    images: string[];
}

export class BigsoloScraper extends BaseScraper {
    readonly name = "BigSolo";
    readonly baseUrl = "https://bigsolo.org";
    readonly lang = "fr";

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get('/data/series');
        const data = res.data as BigSoloSeriesResponse;
        const allSeries = [...(data.reco || []), ...(data.series || []), ...(data.os || [])];
        const unique = new Map<string, BigSoloSeriesItem>();
        allSeries.forEach((s) => unique.set(s.slug, s));
        const items = Array.from(unique.values());
        const pageSize = 24;
        const start = (page - 1) * pageSize;
        const mangas: Manga[] = items.slice(start, start + pageSize).map((s) => ({
            title: s.title,
            url: `/series/${s.slug}`,
            thumbnailUrl: this.absUrl(s.icon || ''),
            lang: this.lang,
        }));
        const hasNextPage = start + pageSize < items.length;
        return { mangas, hasNextPage };
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get('/data/series');
        const data = res.data as BigSoloSeriesResponse;
        const allSeries = [...(data.reco || []), ...(data.series || []), ...(data.os || [])];
        const q = query.toLowerCase();
        const filtered = allSeries.filter((s) => s.title.toLowerCase().includes(q));
        const unique = new Map<string, BigSoloSeriesItem>();
        filtered.forEach((s) => unique.set(s.slug, s));
        const items = Array.from(unique.values());
        const pageSize = 24;
        const start = (page - 1) * pageSize;
        const mangas: Manga[] = items.slice(start, start + pageSize).map((s) => ({
            title: s.title,
            url: `/series/${s.slug}`,
            thumbnailUrl: this.absUrl(s.icon || ''),
            lang: this.lang,
        }));
        const hasNextPage = start + pageSize < items.length;
        return { mangas, hasNextPage };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const slug = mangaUrl.split('/').filter(Boolean).pop() || '';
        const res = await this.get(`/data/series/${slug}`);
        const data = res.data as BigSoloDetailResponse;
        return {
            title: data.title,
            url: mangaUrl,
            thumbnailUrl: this.absUrl(data.icon || ''),
            lang: this.lang,
            author: data.author || undefined,
            description: data.synopsis || undefined,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const slug = mangaUrl.split('/').filter(Boolean).pop() || '';
        const res = await this.get(`/data/series/${slug}`);
        const data = res.data as BigSoloDetailResponse;
        const chapters: Chapter[] = [];
        for (const [key, ch] of Object.entries(data.chapters || {})) {
            chapters.push({
                name: ch.title || `Chapitre ${key}`,
                url: `/data/series/${slug}/${key}`,
                chapterNumber: parseFloat(key),
                scanlator: ch.teams?.join(', ') || undefined,
                dateUpload: ch.timestamp ? ch.timestamp * 1000 : undefined,
            });
        }
        chapters.sort((a, b) => (b.chapterNumber || 0) - (a.chapterNumber || 0));
        return chapters;
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const res = await this.get(chapterUrl);
        const data = res.data as BigSoloPageResponse;
        return (data.images || []).map((img, index) => ({
            imageUrl: this.absUrl(img),
            index,
        }));
    }
}
