import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface PopularMangaData {
    title: string;
    slug: string;
}

interface LatestApiResponse {
    data: Array<{ title: string; slug: string }>;
}

interface MangaDetailsData {
    title: string;
    slug: string;
    author: string;
    artist: string;
    categories: string[];
    status: string;
    description: string;
}

interface PageData {
    currentChapter: {
        isPremium: boolean;
    };
    isPremiumUser: boolean;
    initialData: {
        images: Array<{ order: number; originalUrl: string }>;
    };
}

export class PoseidonscansScraper extends BaseScraper {
    readonly name = 'PoseidonScans';
    readonly baseUrl = 'https://poseidon-scans.net';
    readonly lang = 'fr';

    private toApiCoverUrl(slug: string): string {
        return this.absUrl(`/api/covers/${slug}.webp`);
    }

    private _extractNextJsData<T>(html: string): T | null {
        const $ = this.$(html);
        const scripts = $('script').toArray();
        for (const script of scripts) {
            const text = $(script).text();
            const match = text.match(/self\.__next_f\.push\(\[.*?\]\)/);
            if (match) {
                try {
                    const parsed = JSON.parse(match[0].replace(/self\.__next_f\.push\(/, '').replace(/\)$/, ''));
                    return JSON.parse(parsed[1]) as T;
                } catch (_e) { }
            }
        }
        return null;
    }

    private _parseSearchList(html: string): Manga[] {
        const $ = this.$(html);
        const mangas: Manga[] = [];
        $('div.grid a.block.group').each((_, el) => {
            const $el = $(el);
            const title = $el.find('h2').text().trim();
            const url = $el.attr('href') || '';
            const thumbnailUrl = $el.find('img').attr('alt') || '';
            if (title && url) {
                mangas.push({ title, url, thumbnailUrl, lang: this.lang });
            }
        });
        return mangas;
    }

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get('/', { headers: { 'RSC': '1' } });
        const data = this._extractNextJsData<PopularMangaData[]>(res.data);
        const mangas: Manga[] = (data || []).map(item => ({
            title: item.title,
            url: `/serie/${item.slug}`,
            thumbnailUrl: this.toApiCoverUrl(item.slug),
            lang: this.lang,
        }));
        return { mangas, hasNextPage: mangas.length >= 20 };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const res = await this.get('/api/manga/lastchapters', {
            params: { limit: '16', page: String(page) },
        });
        const body = res.data as LatestApiResponse;
        const mangas: Manga[] = (body.data || []).map(item => ({
            title: item.title,
            url: `/serie/${item.slug}`,
            thumbnailUrl: this.toApiCoverUrl(item.slug),
            lang: this.lang,
        }));
        return { mangas, hasNextPage: mangas.length >= 16 };
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get('/series', {
            params: { search: query, page: String(page) },
        });
        const mangas = this._parseSearchList(res.data);
        const $ = this.$(res.data);
        const hasNextPage = $('a[rel=next]').length > 0;
        return { mangas, hasNextPage };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const res = await this.get(mangaUrl, { headers: { 'RSC': '1' } });
        const data = this._extractNextJsData<MangaDetailsData>(res.data);
        if (!data) {
            const $ = this.$(res.data);
            const title = $('h1').first().text().trim();
            const thumbnailUrl = $('img.cover').first().attr('src') || '';
            const description = $('meta[name=description]').attr('content') || '';
            return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, description };
        }
        return {
            title: data.title,
            url: mangaUrl,
            thumbnailUrl: this.toApiCoverUrl(data.slug),
            lang: this.lang,
            author: data.author || data.artist || undefined,
            description: data.description || undefined,
            genre: data.categories?.join(', ') || undefined,
            status: data.status === 'ONGOING' ? 1 : data.status === 'FINISHED' ? 0 : undefined,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const res = await this.get(mangaUrl, { headers: { 'RSC': '1' } });
        const $ = this.$(res.data);
        const chapters: Chapter[] = [];
        $('a[href*="/chapter/"]').each((_, el) => {
            const url = $(el).attr('href') || '';
            const name = $(el).text().trim();
            if (name && url && !chapters.some(c => c.url === url)) {
                chapters.push({ name, url });
            }
        });
        return chapters.reverse();
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const res = await this.get(chapterUrl, { headers: { 'RSC': '1' } });
        const data = this._extractNextJsData<PageData>(res.data);
        if (!data || !data.initialData) {
            const $ = this.$(res.data);
            const pages: Page[] = [];
            $('img.chapter-image').each((i, el) => {
                const src = $(el).attr('src') || '';
                if (src) {
                    pages.push({ index: i, imageUrl: src });
                }
            });
            return pages;
        }
        const images = data.initialData.images || [];
        return images
            .sort((a, b) => a.order - b.order)
            .map((img, i) => ({ index: i, imageUrl: img.originalUrl }));
    }
}
