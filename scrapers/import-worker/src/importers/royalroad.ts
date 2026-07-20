import { RoyalRoadAPI } from '@fsoc/royalroadl-api';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const RR_BASE = 'https://www.royalroad.com';
const RR_API = new RoyalRoadAPI();
const KEY = 'royalroad';

function buildMediaRow(fiction: any) {
    const externalId = `rr-${fiction.id}`;
    const title = fiction.title;
    const slug = `rr-${fiction.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
    const author = fiction.author || 'Unknown';
    return {
        type: 'novel' as const, title, originalTitle: title, slug, author,
        synopsis: fiction.description?.slice(0, 2000),
        posterUrl: fiction.image || undefined,
        metadataSource: 'royalroad', metadataFreshAt: new Date(), externalId,
    };
}

export async function importRoyalRoad(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, databaseUrl };

    const config: ScannerConfig = {
        key: KEY,
        name: 'RoyalRoad',
        rateLimit: { requestsPerSecond: 2, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 3,
            defaultCheckpointAgeMs: 3600 * 1000,
            fetch: async (fetchLimit: number, _checkpoint: string) => {
                const { data } = await RR_API.fictions.getPopular(1);
                const items = (data || []).slice(0, fetchLimit);
                return { items, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((f: any) => `rr-${f.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((f: any) => !existing.has(`rr-${f.id}`));
                if (toInsert.length === 0) return 0;

                const mediaValues = toInsert.map((fiction: any) => buildMediaRow(fiction));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const extToId = new Map(inserted.map(m => [m.externalId, m.id]));
                const lienValues: any[] = [];
                for (const fiction of toInsert) {
                    const externalId = `rr-${fiction.id}`;
                    const mediaId = extToId.get(externalId);
                    if (!mediaId) continue;
                    lienValues.push({ mediaId, sourceSite: 'royalroad', url: `${RR_BASE}/fiction/${fiction.id}`, quality: 'original', language: 'EN' });
                }
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'novel' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                for (const m of inserted) log.success(`[RR] ${m.externalId}`);
                return inserted.length;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: 1,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const page = offset || 1;
                const { data } = await RR_API.fictions.getPopular(page);
                const items = (data || []).slice(0, fetchLimit);
                return { items, hasMore: items.length === fetchLimit };
            },
            getTotal: () => 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) {
                    // End of catalog: reset page to 1
                    return 0;
                }
                const ids = items.map((f: any) => `rr-${f.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((f: any) => !existing.has(`rr-${f.id}`));
                if (toInsert.length === 0) {
                    log.skip('RoyalRoad: all existing');
                    return 0;
                }

                const mediaValues = toInsert.map((fiction: any) => buildMediaRow(fiction));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const extToId = new Map(inserted.map(m => [m.externalId, m.id]));
                const lienValues: any[] = [];
                for (const fiction of toInsert) {
                    const externalId = `rr-${fiction.id}`;
                    const mediaId = extToId.get(externalId);
                    if (!mediaId) continue;
                    lienValues.push({ mediaId, sourceSite: 'royalroad', url: `${RR_BASE}/fiction/${fiction.id}`, quality: 'original', language: 'EN' });
                }
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'novel' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                for (const m of inserted) log.success(`[RR] ${m.externalId}`);
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
