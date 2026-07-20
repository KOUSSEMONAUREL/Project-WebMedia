import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const PG_API = 'https://project-gutenberg-free-books-api1.p.rapidapi.com/books';
const KEY = 'gutenberg';

function buildMediaRow(item: any) {
    const title = (item.title || '').substring(0, 490);
    const externalId = `gutenberg-${item.id}`;
    const authors = (item.authors?.map((a: any) => a.name).join(', ') || 'Unknown').substring(0, 290);
    const slug = `book-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
    return {
        type: 'book' as const, title, originalTitle: title, author: authors,
        synopsis: item.synopsis || `Project Gutenberg — ${title}`,
        posterUrl: item.cover_image || undefined,
        externalId, slug,
        metadataSource: 'gutenberg', metadataFreshAt: new Date(),
    };
}

export async function importGutenberg(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, databaseUrl };
    const gutenbergKey = process.env.GUTENBERG_API_KEY || '';
    if (!gutenbergKey) return 0;

    const config: ScannerConfig = {
        key: KEY,
        name: 'Gutenberg',
        rateLimit: { requestsPerSecond: 1, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 7,
            defaultCheckpointAgeMs: 24 * 3600 * 1000,
            fetch: async (fetchLimit: number, _checkpoint: string) => {
                const response = await withRetry(() => axios.get(PG_API, {
                    params: { q: 'popular', page_size: fetchLimit, page: 1 },
                    headers: {
                        'X-RapidAPI-Key': gutenbergKey,
                        'X-RapidAPI-Host': 'project-gutenberg-free-books-api1.p.rapidapi.com'
                    }
                }));
                const results = (response.data?.results || response.data || []) as any[];
                return { items: results, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((item: any) => `gutenberg-${item.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((item: any) => !existing.has(`gutenberg-${item.id}`));
                if (toInsert.length === 0) return 0;

                const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const lienValues = inserted.map(m => ({
                    mediaId: m.id, sourceSite: 'gutenberg',
                    url: `https://www.gutenberg.org/ebooks/${m.externalId?.replace('gutenberg-', '')}`,
                    quality: 'original', language: 'EN',
                }));
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                for (const m of inserted) log.success(`[GUTENBERG] ${m.externalId}`);
                return inserted.length;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: 1,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const page = offset || 1;
                const response = await withRetry(() => axios.get(PG_API, {
                    params: { q: 'popular', page_size: fetchLimit, page },
                    headers: {
                        'X-RapidAPI-Key': gutenbergKey,
                        'X-RapidAPI-Host': 'project-gutenberg-free-books-api1.p.rapidapi.com'
                    }
                }));
                const results = (response.data?.results || response.data || []) as any[];
                return { items: results, hasMore: results.length === fetchLimit };
            },
            getTotal: () => 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((item: any) => `gutenberg-${item.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((item: any) => !existing.has(`gutenberg-${item.id}`));
                if (toInsert.length === 0) {
                    log.skip('Gutenberg: all existing');
                    return 0;
                }

                const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const lienValues = inserted.map(m => ({
                    mediaId: m.id, sourceSite: 'gutenberg',
                    url: `https://www.gutenberg.org/ebooks/${m.externalId?.replace('gutenberg-', '')}`,
                    quality: 'original', language: 'EN',
                }));
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                for (const m of inserted) log.success(`[GUTENBERG] ${m.externalId}`);
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
