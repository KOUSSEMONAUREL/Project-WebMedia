import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface TopMangaItem {
    title: string;
    coverImage: string;
    slug: string;
}

interface TopMangaDto {
    top: TopMangaItem[];
}

interface LatestMangaItem {
    title: string;
    coverImage: string;
    slug: string;
}

interface Pagination {
    currentPage: number;
    totalPages: number;
}

interface LatestMangaDto {
    latest: LatestMangaItem[];
    pagination: Pagination;
}

interface SearchMangaItem {
    title: string;
    coverImage: string;
    slug: string;
}

interface SearchResultsDto {
    mangas: SearchMangaItem[];
    pagination: { page: number; totalPages: number };
}

interface ChapterDetail {
    number: number;
    createdAt: string;
}

interface MangaDetailDto {
    manga: {
        title: string;
        coverImage: string;
        slug: string;
        synopsis: string;
        status: string;
    };
    chapters: ChapterDetail[];
}

interface ChapterContentDto {
    chapter: {
        images: string[];
    };
}

export class PhenixscansScraper extends BaseScraper {
    readonly name = 'PhenixScans';
    readonly baseUrl = 'https://phenix-scans.co';
    readonly apiBaseUrl = 'https://api.phenix-scans.co/api';
    readonly lang = 'fr';

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiBaseUrl}/front/homepage`, {
            params: { section: 'top' },
        });
        const body = res.data as TopMangaDto;
        const items = body.top || [];
        const mangas = items.map(item => ({
            title: item.title,
            url: `/manga/${item.slug}`,
            thumbnailUrl: item.coverImage,
            lang: this.lang,
        }));
        return { mangas, hasNextPage: false };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.apiBaseUrl}/front/homepage`, {
            params: { page: String(page), section: 'latest', limit: '12' },
        });
        const body = res.data as LatestMangaDto;
        const items = body.latest || [];
        const mangas = items.map(item => ({
            title: item.title,
            url: `/manga/${item.slug}`,
            thumbnailUrl: item.coverImage,
            lang: this.lang,
        }));
        const totalPages = body.pagination?.totalPages || 1;
        return { mangas, hasNextPage: page < totalPages };
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        if (query.trim()) {
            const res = await this.get(`${this.apiBaseUrl}/front/manga/search`, {
                params: { q: query },
            });
            const body = res.data as { mangas: TopMangaItem[] };
            const items = body.mangas || [];
            const mangas = items.map(item => ({
                title: item.title,
                url: `/manga/${item.slug}`,
                thumbnailUrl: item.coverImage,
                lang: this.lang,
            }));
            return { mangas, hasNextPage: false };
        }
        const res = await this.get(`${this.apiBaseUrl}/front/manga`, {
            params: {
                sort: 'title',
                genre: '',
                type: '',
                status: '',
                limit: '18',
                page: String(page),
            },
        });
        const body = res.data as SearchResultsDto;
        const items = body.mangas || [];
        const mangas = items.map(item => ({
            title: item.title,
            url: `/manga/${item.slug}`,
            thumbnailUrl: item.coverImage,
            lang: this.lang,
        }));
        const totalPages = body.pagination?.totalPages || 1;
        return { mangas, hasNextPage: page < totalPages };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const slug = mangaUrl.replace('/manga/', '');
        const res = await this.get(`${this.apiBaseUrl}/front/manga/${slug}`);
        const body = res.data as MangaDetailDto;
        return {
            title: body.manga.title,
            url: mangaUrl,
            thumbnailUrl: body.manga.coverImage,
            lang: this.lang,
            description: body.manga.synopsis,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const slug = mangaUrl.replace('/manga/', '');
        const res = await this.get(`${this.apiBaseUrl}/front/manga/${slug}`);
        const body = res.data as MangaDetailDto;
        const chapters = body.chapters || [];
        return chapters
            .map(ch => ({
                name: `Chapter ${ch.number}`,
                url: `/manga/${slug}/chapter/${ch.number}`,
                chapterNumber: ch.number,
                dateUpload: new Date(ch.createdAt).getTime(),
            }));
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const parts = chapterUrl.split('/');
        const slug = parts[2];
        const number = parts[4];
        const res = await this.get(`${this.apiBaseUrl}/front/manga/${slug}/chapter/${number}`);
        const body = res.data as ChapterContentDto;
        const images = body.chapter?.images || [];
        return images.map((url, idx) => ({
            index: idx,
            imageUrl: this.absUrl(url),
        }));
    }
}
