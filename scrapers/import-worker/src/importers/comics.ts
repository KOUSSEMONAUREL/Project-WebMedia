import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const COMICVINE_URL = 'https://comicvine.gamespot.com/api/volumes/';
const KEY = 'comicvine';

function buildMediaRow(item: any) {
    return {
        type: 'comic' as const, title: item.name,
        slug: `comic-${item.id}-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
        synopsis: item.deck || item.description,
        year: item.start_year ? parseInt(item.start_year) : null,
        posterUrl: item.image?.super_url || item.image?.original_url,
        duration: item.count_of_issues || undefined,
        studios: item.publisher?.name ? JSON.stringify([item.publisher.name]) : undefined,
        voteCount: item.count_of_issues || undefined,
        externalId: `cv-${item.id}`,
        metadataSource: 'comicvine', metadataFreshAt: new Date(),
    };
}

export async function importComics(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, internalApiUrl: internalApiUrl ?? undefined, internalApiKey: internalApiKey ?? undefined, databaseUrl };

    const config: ScannerConfig = {
        key: KEY,
        name: 'ComicVine',
        rateLimit: { requestsPerSecond: 0.5, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 7,
            defaultCheckpointAgeMs: 24 * 3600 * 1000,
            fetch: async (fetchLimit: number, _checkpoint: string) => {
                const response = await withRetry(() => axios.get(COMICVINE_URL, {
                    params: {
                        api_key: apiKey, format: 'json', sort: 'date_last_updated:desc',
                        limit: fetchLimit, offset: 0,
                        field_list: 'id,name,description,image,start_year,deck,count_of_issues,publisher,site_detail_url'
                    }
                }));
                const results = response.data.results || [];
                return { items: results, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((r: any) => `cv-${r.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toUpdate = items.filter((r: any) => existing.has(`cv-${r.id}`));
                for (const item of toUpdate) {
                    const row = buildMediaRow(item);
                    await db.update(medias).set({ ...row, externalId: undefined, slug: undefined, type: undefined, metadataFreshAt: new Date() })
                        .where(eq(medias.externalId, `cv-${item.id}`));
                }

                const toInsert = items.filter((r: any) => !existing.has(`cv-${r.id}`));
                if (toInsert.length > 0) {
                    const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                        .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                    const brainItems = inserted.map(m => ({ id: m.id, type: 'comic' as const, title: m.title, slug: m.slug }));
                    await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

                    for (const m of inserted) log.success(`[COMIC] ${m.externalId}`);
                }

                const affected = toUpdate.length + toInsert.length;
                if (affected > 0) log.info(`Freshness: ${affected} affected`);
                return affected;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: limit,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const response = await withRetry(() => axios.get(COMICVINE_URL, {
                    params: {
                        api_key: apiKey, format: 'json', sort: 'date_added:desc',
                        limit: fetchLimit, offset,
                        field_list: 'id,name,description,image,start_year,deck,count_of_issues,publisher,site_detail_url'
                    }
                }));
                const results = response.data.results || [];
                return { items: results, hasMore: results.length === fetchLimit };
            },
            getTotal: () => 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((r: any) => `cv-${r.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((r: any) => !existing.has(`cv-${r.id}`));
                if (toInsert.length === 0) {
                    log.skip('ComicVine: all existing');
                    return 0;
                }

                const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const brainItems = inserted.map(m => ({ id: m.id, type: 'comic' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

                for (const m of inserted) log.success(`[COMIC] ${m.externalId}`);
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
