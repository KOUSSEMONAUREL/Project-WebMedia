import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
const KEY = 'books';
const CATEGORIES = ['fiction', 'fantasy', 'thriller', 'romance', 'science fiction'];
const MAX_PAGES = 100;

function buildMediaRow(item: any, cat: string) {
    const info = item.volumeInfo || {};
    const title = (info.title || 'Titre inconnu').substring(0, 490);
    const externalId = `googlebooks-${item.id}`;
    const author = (info.authors ? info.authors.join(', ') : 'Unknown').substring(0, 290);
    return {
        type: 'book' as const, title, originalTitle: info.title, author,
        slug: `book-${externalId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
        synopsis: info.description,
        year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
        posterUrl: info.imageLinks?.thumbnail,
        rating: info.averageRating ? String(info.averageRating) : undefined,
        voteCount: info.ratingsCount || 0,
        genres: info.categories?.length ? JSON.stringify(info.categories) : undefined,
        studios: info.publisher ? JSON.stringify([info.publisher]) : undefined,
        duration: info.pageCount || undefined,
        externalId,
        metadataSource: 'google-books', metadataFreshAt: new Date(),
    };
}

export async function importPopularBooks(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 5) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, internalApiUrl: internalApiUrl ?? undefined, internalApiKey: internalApiKey ?? undefined, databaseUrl };

    const config: ScannerConfig = {
        key: KEY,
        name: 'Google Books',
        rateLimit: { requestsPerSecond: 2, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 3,
            defaultCheckpointAgeMs: 3600 * 1000,
            fetch: async (fetchLimit: number, _checkpoint: string) => {
                const allItems: any[] = [];
                for (const cat of CATEGORIES.slice(0, 2)) {
                    try {
                        const res = await withRetry(() => axios.get(GOOGLE_BOOKS_URL, {
                            params: { q: `subject:${cat}`, orderBy: 'newest', maxResults: fetchLimit, key: apiKey, langRestrict: 'fr' }
                        }));
                        for (const item of res.data.items || []) {
                            (item as any)._cat = cat;
                            allItems.push(item);
                        }
                    } catch { /* skip category */ }
                }
                return { items: allItems, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((i: any) => `googlebooks-${i.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((i: any) => !existing.has(`googlebooks-${i.id}`));
                if (toInsert.length === 0) return 0;

                const mediaValues = toInsert.map((item: any) => buildMediaRow(item, item._cat));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const extToId = new Map(inserted.map(m => [m.externalId, m.id]));
                const lienValues: any[] = [];
                for (const item of toInsert) {
                    const info = (item as any).volumeInfo;
                    const bookUrl = info.previewLink || info.infoLink;
                    const mediaId = extToId.get(`googlebooks-${item.id}`);
                    if (!mediaId || !bookUrl) continue;
                    lienValues.push({ mediaId, sourceSite: 'google-books', url: bookUrl, quality: 'original', language: 'FR' });
                }
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

                for (const m of inserted) log.success(`[BOOK] ${m.externalId}`);
                return inserted.length;
            },
        },
        discovery: {
            maxPages: MAX_PAGES,
            advanceBy: 1,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const slot = offset % (CATEGORIES.length * MAX_PAGES);
                const pageNum = Math.floor(slot / CATEGORIES.length) + 1;
                const catIdx = slot % CATEGORIES.length;
                const category = CATEGORIES[catIdx];

                const res = await withRetry(() => axios.get(GOOGLE_BOOKS_URL, {
                    params: { q: `subject:${category}`, orderBy: 'newest', maxResults: fetchLimit, startIndex: pageNum > 1 ? (pageNum - 1) * fetchLimit : 0, key: apiKey, langRestrict: 'fr' }
                }));
                const items = (res.data.items || []).map((r: any) => ({ ...r, _cat: category }));
                const totalItems = res.data.totalItems || 0;
                const maxPage = Math.ceil(Math.min(totalItems, 100) / fetchLimit);

                return {
                    items,
                    total: CATEGORIES.length * maxPage,
                    hasMore: pageNum < maxPage,
                };
            },
            getTotal: (result: FetchResult) => result.total || 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;

                let totalInserted = 0;
                for (const cat of CATEGORIES) {
                    const catItems = items.filter((i: any) => i._cat === cat);
                    if (catItems.length === 0) continue;

                    const itemKeys = catItems.map((i: any) => `googlebooks-${i.id}`);
                    const existing = await batchCheckExisting(db, medias.externalId, itemKeys);
                    const toInsert = catItems.filter((i: any) => !existing.has(`googlebooks-${i.id}`));
                    if (toInsert.length === 0) {
                        log.skip(`Books ${cat}: all existing`);
                        continue;
                    }

                    const mediaValues = toInsert.map((item: any) => buildMediaRow(item, cat));
                    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                        .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                    const extToId = new Map(inserted.map(m => [m.externalId, m.id]));
                    const lienValues: any[] = [];
                    for (const item of toInsert) {
                        const info = (item as any).volumeInfo;
                        const bookUrl = info.previewLink || info.infoLink;
                        const mediaId = extToId.get(`googlebooks-${item.id}`);
                        if (!mediaId || !bookUrl) continue;
                        lienValues.push({ mediaId, sourceSite: 'google-books', url: bookUrl, quality: 'original', language: 'FR' });
                    }
                    if (lienValues.length > 0) {
                        await db.insert(liens).values(lienValues).onConflictDoNothing();
                    }

                    const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                    await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

                    for (const m of inserted) log.success(`[BOOK] ${m.externalId}`);
                    totalInserted += inserted.length;
                }
                return totalInserted;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
