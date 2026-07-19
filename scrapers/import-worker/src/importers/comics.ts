import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const COMICVINE_URL = 'https://comicvine.gamespot.com/api/volumes';
const KEY = 'comicvine';

async function processComicVineOffset(apiKey: string, offset: number, limit: number, db: any, log: ReturnType<typeof createLog>, internalApiUrl: string | null, internalApiKey: string | null): Promise<number> {
    const response = await withRetry(() => axios.get(COMICVINE_URL, {
        params: {
            api_key: apiKey, format: 'json', sort: 'date_added:desc',
            limit, offset, field_list: 'id,name,description,image,start_year,deck,count_of_issues,publisher,site_detail_url'
        }
    }));

    const results = response.data.results || [];
    if (results.length === 0) return 0;

    const externalIds = results.map((r: any) => `cv-${r.id}`);
    const existing = await batchCheckExisting(db, medias.externalId, externalIds);

    const toInsert = results.filter((r: any) => !existing.has(`cv-${r.id}`));
    if (toInsert.length === 0) {
        log.skip(`ComicVine offset ${offset}: all existing`);
        return 0;
    }

    const mediaValues = toInsert.map((item: any) => ({
        type: 'comic', title: item.name,
        slug: `comic-${item.id}-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
        synopsis: item.deck || item.description,
        year: item.start_year ? parseInt(item.start_year) : null,
        posterUrl: item.image?.super_url || item.image?.original_url,
        duration: item.count_of_issues || undefined,
        studios: item.publisher?.name ? JSON.stringify([item.publisher.name]) : undefined,
        voteCount: item.count_of_issues || undefined,
        externalId: `cv-${item.id}`,
        metadataSource: 'comicvine', metadataFreshAt: new Date()
    }));

    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

    const brainItems = inserted.map(m => ({ id: m.id, type: 'comic' as const, title: m.title, slug: m.slug }));
    await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

    for (const m of inserted) {
        log.success(`[COMIC] ${m.externalId}`);
    }

    log.success(`ComicVine: ${inserted.length} added (offset ${offset})`);
    return inserted.length;
}

export async function importComics(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('ComicVine', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        const offset = await getOffset(KEY, databaseUrl, 0);

        // Freshness pass: always check offset 0 for newly added comics
        let freshCount = 0;
        if (offset > 0) {
            try {
                freshCount = await processComicVineOffset(apiKey, 0, limit, db, log, internalApiUrl, internalApiKey);
                if (freshCount > 0) log.info(`Freshness: ${freshCount} new comics`);
            } catch (err: any) {
                log.warn(`Freshness pass failed: ${err.message}`);
            }
        }

        // Deep pass: continue from stored offset
        const deepCount = await processComicVineOffset(apiKey, offset, limit, db, log, internalApiUrl, internalApiKey);
        await setOffset(KEY, offset + limit, databaseUrl);
        return deepCount + freshCount;
    } catch (err: any) {
        log.error(`Comic Vine Error: ${err.message}`);
        throw err;
    }
}
