import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface DivaMangaItem {
    title?: string;
    name?: string;
    slug?: string;
    urlSlug?: string;
    type?: string;
    category?: string;
    coverImage?: string;
    thumbnail?: string;
    description?: string;
    author?: string;
    artist?: string;
    status?: string;
}

interface DivaSeriesResponse {
    data?: DivaMangaItem[];
    series?: DivaMangaItem[];
    items?: DivaMangaItem[];
    results?: DivaMangaItem[];
    mangas?: DivaMangaItem[];
    meta?: { pagination?: { page?: number; pageCount?: number } };
    totalPages?: number;
}

export class DivascansScraper extends BaseScraper {
    readonly name = 'DivaScans';
    readonly baseUrl = 'https://divascans.org';
    readonly lang = 'en';

    private mangaList(res: DivaSeriesResponse): DivaMangaItem[] {
        return res.data ?? res.series ?? res.items ?? res.results ?? res.mangas ?? [];
    }

    private mapManga(item: DivaMangaItem) {
        const slug = item.urlSlug ?? item.slug ?? '';
        const type = (item.type ?? item.category ?? 'comic').toLowerCase();
        const urlType = type.includes('novel') ? 'novel' : 'comic';
        return {
            title: item.title ?? item.name ?? '',
            url: `/series/${urlType}/${slug}`,
            thumbnailUrl: item.coverImage ?? item.thumbnail ?? '',
            lang: this.lang,
        };
    }

    async getPopular(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.baseUrl}/api/series`, {
            params: { sort: 'popular', page: String(page) },
        });
        const body = res.data as DivaSeriesResponse;
        const mangas = this.mangaList(body).map(i => this.mapManga(i));
        const pageCount = body.meta?.pagination?.pageCount ?? body.totalPages ?? 1;
        return { mangas, hasNextPage: page < pageCount };
    }

    async getLatest(page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.baseUrl}/api/series`, {
            params: { page: String(page) },
        });
        const body = res.data as DivaSeriesResponse;
        const mangas = this.mangaList(body).map(i => this.mapManga(i));
        const pageCount = body.meta?.pagination?.pageCount ?? body.totalPages ?? 1;
        return { mangas, hasNextPage: page < pageCount };
    }

    async getSearch(query: string, page = 1): Promise<SearchResult> {
        const res = await this.get(`${this.baseUrl}/api/search`, {
            params: { q: query, page: String(page) },
        });
        const body = res.data as DivaSeriesResponse;
        const mangas = this.mangaList(body).map(i => this.mapManga(i));
        const pageCount = body.meta?.pagination?.pageCount ?? body.totalPages ?? 1;
        return { mangas, hasNextPage: page < pageCount };
    }

    async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
        const res = await this.get(mangaUrl);
        const $ = this.$(res.data as string);
        const title = $('h1').first().text() || '';
        const cover = $('img[src*="cover"], img[src*="thumbnail"]').first().attr('src') || '';
        const desc = $('div:contains(Synopsis), div:contains(Description)').first().next().text() || '';
        return {
            title,
            url: mangaUrl,
            thumbnailUrl: this.absUrl(cover),
            description: desc.replace(/<[^>]*>/g, '').trim(),
            lang: this.lang,
        };
    }

    async getChapterList(mangaUrl: string): Promise<Chapter[]> {
        const res = await this.get(mangaUrl);
        const html = res.data as string;
        const $ = this.$(html);
        const chapters: Chapter[] = [];
        $('a[href*="/chapter/"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const name = $(el).text().trim();
            const url = href.startsWith('http') ? href : this.absUrl(href);
            if (!url.includes('/chapter/')) return;
            chapters.push({
                name: name || 'Chapter',
                url,
                chapterNumber: parseFloat(name.replace(/[^0-9.]/g, '')) || undefined,
            });
        });
        return chapters;
    }

    async getPageList(chapterUrl: string): Promise<Page[]> {
        const res = await this.get(chapterUrl);
        const html = res.data as string;
        const $ = this.$(html);
        const imgs = $('div.reader-images img, div.chapter-container img, main img[src*="chapter"]');
        if (imgs.length > 0) {
            return imgs.map((i, el) => ({
                index: i,
                imageUrl: this.absUrl($(el).attr('data-src') || $(el).attr('src') || ''),
            })).get();
        }
        const re = /https?:\/\/[^"'\\]+\.(?:jpg|jpeg|png|webp)/g;
        const urls = [...new Set(html.match(re) || [])];
        return urls.map((url, i) => ({ index: i, imageUrl: url }));
    }
}
