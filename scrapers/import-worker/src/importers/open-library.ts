import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const OPEN_LIBRARY_API = 'https://openlibrary.org';
const KEY = 'openlibrary';

function buildMediaRow(item: any) {
    const key = item?.key || '';
    const externalId = `ol-${key.replace('/works/', '')}`;
    const title = item.title;
    const slug = `book-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
    const author = item.author_name ? item.author_name.join(', ') : item.authors ? item.authors.map((a: any) => a.name).join(', ') : 'Unknown';
    const genreNames = (item.subject || item.subjects || [])
        .filter((s: string) => typeof s === 'string')
        .slice(0, 5);
    return {
        type: 'book' as const, title, originalTitle: title, author,
        synopsis: item.first_sentence ? item.first_sentence[0] : '',
        posterUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : undefined,
        genres: genreNames.length ? JSON.stringify(genreNames) : undefined,
        externalId, slug, metadataSource: 'openlibrary', metadataFreshAt: new Date(),
    };
}

export async function importOpenLibrary(databaseUrl: string, search: string = 'popular', limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, databaseUrl };

    const config: ScannerConfig = {
        key: KEY,
        name: 'Open Library',
        rateLimit: { requestsPerSecond: 1, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 3,
            defaultCheckpointAgeMs: 3600 * 1000,
            fetch: async (fetchLimit: number, _checkpoint: string) => {
                const response = await withRetry(() => axios.get(`${OPEN_LIBRARY_API}/search.json`, {
                    params: { q: search, page: 1, limit: fetchLimit }
                }));
                const results = response.data.docs || [];
                return { items: results, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((item: any) => {
                    const key = item?.key || '';
                    return `ol-${key.replace('/works/', '')}`;
                }).filter(Boolean);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((item: any) => {
                    const key = item?.key || '';
                    return !existing.has(`ol-${key.replace('/works/', '')}`);
                });
                if (toInsert.length === 0) return 0;

                const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const lienValues = inserted.map(m => ({
                    mediaId: m.id, sourceSite: 'openlibrary',
                    url: `${OPEN_LIBRARY_API}/works/${m.externalId?.replace('ol-', '')}`,
                    quality: 'original', language: 'EN'
                }));
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                for (const m of inserted) log.success(`[OPENLIB] ${m.externalId}`);
                return inserted.length;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: 1,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const page = offset || 1;
                const response = await withRetry(() => axios.get(`${OPEN_LIBRARY_API}/search.json`, {
                    params: { q: search, page, limit: fetchLimit }
                }));
                const results = response.data.docs || [];
                return { items: results, hasMore: results.length === fetchLimit };
            },
            getTotal: () => 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((item: any) => {
                    const key = item?.key || '';
                    return `ol-${key.replace('/works/', '')}`;
                }).filter(Boolean);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((item: any) => {
                    const key = item?.key || '';
                    return !existing.has(`ol-${key.replace('/works/', '')}`);
                });
                if (toInsert.length === 0) {
                    log.skip('OpenLibrary: all existing');
                    return 0;
                }

                const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const lienValues = inserted.map(m => ({
                    mediaId: m.id, sourceSite: 'openlibrary',
                    url: `${OPEN_LIBRARY_API}/works/${m.externalId?.replace('ol-', '')}`,
                    quality: 'original', language: 'EN'
                }));
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                for (const m of inserted) log.success(`[OPENLIB] ${m.externalId}`);
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
