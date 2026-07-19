import { RoyalRoadAPI } from '@fsoc/royalroadl-api';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import axios from 'axios';
import { batchCheckExisting, notifyBrain, notifyBrainBatch } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const RR_BASE = 'https://www.royalroad.com';
const RR_API = new RoyalRoadAPI();
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || (process.env.ENVIRONMENT === 'development' ? 'http://localhost:8787/api/internal' : 'https://api.webmediia.cfd/api/internal');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

async function processRoyalRoadCandidates(candidates: any[], db: any, log: ReturnType<typeof createLog>): Promise<number> {
    const externalIds = candidates.map((f: any) => `rr-${f.id}`);
    const existing = await batchCheckExisting(db, medias.externalId, externalIds);
    const toInsert = candidates.filter((f: any) => !existing.has(`rr-${f.id}`));

    if (toInsert.length === 0) {
        log.skip('RoyalRoad: all existing');
        return 0;
    }

    const mediaValues = toInsert.map((fiction: any) => {
        const externalId = `rr-${fiction.id}`;
        const title = fiction.title;
        const slug = `rr-${fiction.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
        const author = fiction.author || 'Unknown';
        return {
            type: 'novel', title, originalTitle: title, slug, author,
            synopsis: fiction.description?.slice(0, 2000),
            posterUrl: fiction.image || undefined,
            metadataSource: 'royalroad', metadataFreshAt: new Date(), externalId,
        };
    });

    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

    const extToId = new Map(inserted.map(m => [m.externalId, m.id]));

    const lienValues: any[] = [];
    for (const fiction of toInsert) {
        const externalId = `rr-${fiction.id}`;
        const mediaId = extToId.get(externalId);
        if (!mediaId) continue;
        lienValues.push({ mediaId, sourceSite: 'royalroad', url: `${RR_BASE}/fiction/${fiction.id}`, quality: 'original', language: 'EN' });
    }

    if (lienValues.length > 0) {
        await db.insert(liens).values(lienValues).onConflictDoNothing().catch(() => {});
    }

    const brainItems = inserted.map(m => ({ id: m.id, type: 'novel' as const, title: m.title, slug: m.slug }));
    await notifyBrainBatch(brainItems, INTERNAL_API_URL, INTERNAL_API_KEY);

    for (const m of inserted) {
        log.success(`[RR] ${m.externalId}`);
    }

    return inserted.length;
}

export async function importRoyalRoad(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('RoyalRoad', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        let page = await getOffset('royalroad-page', databaseUrl, 1, db);
        let consumed = await getOffset('royalroad-consumed', databaseUrl, 0, db);

        // Freshness pass: always check page 1 for new popular fictions
        if (page > 1 || consumed > 0) {
            try {
                const { data: freshData } = await RR_API.fictions.getPopular(1);
                if (freshData && freshData.length > 0) {
                    const freshCount = await processRoyalRoadCandidates(freshData, db, log);
                    if (freshCount > 0) log.info(`Freshness: ${freshCount} new fictions`);
                }
            } catch (err: any) {
                log.warn(`Freshness pass failed: ${err.message}`);
            }
        }

        // Deep pass: continue from stored page+consumed
        const candidates: any[] = [];
        let safety = 0;

        while (candidates.length < limit && safety < 10) {
            safety++;
            const { data } = await RR_API.fictions.getPopular(page);
            if (!data || data.length === 0) {
                log.skip('End of catalog, reset to page 1');
                await setOffset('royalroad-page', 1, databaseUrl);
                await setOffset('royalroad-consumed', 0, databaseUrl);
                if (candidates.length === 0) return 0;
                break;
            }

            const pageSize = data.length;
            if (consumed >= pageSize) {
                page++;
                consumed = 0;
                continue;
            }

            const remaining = limit - candidates.length;
            const batch = data.slice(consumed, consumed + remaining);
            candidates.push(...batch);

            consumed += batch.length;
            if (consumed >= pageSize) {
                page++;
                consumed = 0;
            }
        }

        await setOffset('royalroad-page', page, databaseUrl, db);
        await setOffset('royalroad-consumed', consumed, databaseUrl, db);

        const deepCount = await processRoyalRoadCandidates(candidates, db, log);
        log.success(`RoyalRoad: ${deepCount} new (page ${page})`);
        return deepCount;
    } catch (error: any) {
        log.error(`RoyalRoad Import Error: ${error.message}`);
        throw error;
    }
}
