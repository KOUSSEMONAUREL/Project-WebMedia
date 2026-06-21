import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface SeriesListDto {
    series: Array<{ slug: string; title: string; cover: string }>;
    hasMore: boolean;
}

interface NextChapterDto {
    number: number;
    type: string;
    title: string;
    images: Array<{ order: number; url: string }>;
    date: string;
}

export class RimuscansScraper extends BaseScraper {
    readonly name = 'RimuScans';
    readonly baseUrl = 'https://rimuscan.fr';
    readonly lang = 'fr';

    private _parseSeriesList(data: SeriesListDto): Manga[] {
        return (data.series || []).map(item => ({
            title: item.title,
            url: `/${item.slug}`,
            thumbnailUrl: item.cover ? this.absUrl(item.cover) : '',
            lang: this.lang,
        }));
    }

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get('/api/series', {
            params: { sort: 'rating', page: String(page) },
        });
        const body = res.data as SeriesListDto;
        const mangas = this._parseSeriesList(body);
        return { mangas, hasNextPage: !!body.hasMore };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const res = await this.get('/api/series', {
            params: { page: String(page) },
        });
        const body = res.data as SeriesListDto;
        const mangas = this._parseSeriesList(body);
        return { mangas, hasNextPage: !!body.hasMore };
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get('/api/series', {
            params: { search: query, page: String(page) },
        });
        const body = res.data as SeriesListDto;
        const mangas = this._parseSeriesList(body);
        return { mangas, hasNextPage: !!body.hasMore };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const res = await this.get(mangaUrl);
        const $ = this.$(res.data);
        const ldJsonText = $('script[type="application/ld+json"]').first().text();
        if (ldJsonText) {
            try {
                const ld = JSON.parse(ldJsonText);
                return {
                    title: ld.name || '',
                    url: mangaUrl,
                    thumbnailUrl: ld.image || '',
                    lang: this.lang,
                    author: ld.author?.name || ld.author || undefined,
                    description: ld.description || undefined,
                };
            } catch (_e) { }
        }
        const title = $('h1').first().text().trim();
        const thumbnailUrl = $('meta[property="og:image"]').attr('content') ||
                             $('img.cover').first().attr('src') || '';
        const description = $('meta[name="description"]').attr('content') || '';
        return { title, url: mangaUrl, thumbnailUrl, lang: this.lang, description };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const res = await this.get(mangaUrl);
        const $ = this.$(res.data);
        const chapters: Chapter[] = [];

        const walkJson = (obj: unknown, depth = 0): void => {
            if (depth > 20 || !obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach(item => walkJson(item, depth + 1));
                return;
            }
            const record = obj as Record<string, unknown>;
            if (record.number !== undefined && record.type && typeof record.number === 'number') {
                const ch = record as unknown as NextChapterDto;
                chapters.push({
                    name: ch.title || `Ch. ${ch.number}`,
                    url: `${mangaUrl}/chapter/${ch.number}`,
                    chapterNumber: ch.number,
                    dateUpload: ch.date ? new Date(ch.date).getTime() : undefined,
                });
                return;
            }
            for (const val of Object.values(record)) {
                walkJson(val, depth + 1);
            }
        };

        const scripts = $('script').toArray();
        for (const script of scripts) {
            const text = $(script).text();
            if (text.includes('self.__next_f')) {
                const matches = text.matchAll(/self\.__next_f\.push\(\[.*?(\{.*\})\)?\]\)/g);
                for (const match of matches) {
                    try {
                        const parsed = JSON.parse(match[1]);
                        walkJson(parsed);
                    } catch (_e) { }
                }
            }
        }
        return chapters.reverse();
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const res = await this.get(chapterUrl);
        const $ = this.$(res.data);
        const pages: Page[] = [];

        const walkJson = (obj: unknown, depth = 0): void => {
            if (depth > 20 || !obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                const images = obj.filter((item): item is { order: number; url: string } =>
                    item && typeof item === 'object' && 'order' in item && 'url' in item,
                );
                if (images.length > 0) {
                    images
                        .sort((a, b) => a.order - b.order)
                        .forEach((img, i) => {
                            pages.push({ index: i, imageUrl: this.absUrl(img.url) });
                        });
                    return;
                }
                obj.forEach(item => walkJson(item, depth + 1));
                return;
            }
            const record = obj as Record<string, unknown>;
            for (const val of Object.values(record)) {
                walkJson(val, depth + 1);
            }
        };

        const scripts = $('script').toArray();
        for (const script of scripts) {
            const text = $(script).text();
            if (text.includes('self.__next_f')) {
                const matches = text.matchAll(/self\.__next_f\.push\(\[.*?(\{.*\})\)?\]\)/g);
                for (const match of matches) {
                    try {
                        const parsed = JSON.parse(match[1]);
                        walkJson(parsed);
                        if (pages.length > 0) return pages;
                    } catch (_e) { }
                }
            }
        }

        $('img.chapter-image, .reading-content img').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src') || '';
            if (src) {
                pages.push({ index: i, imageUrl: this.absUrl(src) });
            }
        });
        return pages;
    }
}
