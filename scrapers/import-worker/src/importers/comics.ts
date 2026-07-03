import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const COMICVINE_URL = 'https://comicvine.gamespot.com/api/volumes';
const KEY = 'comicvine';

export async function importComics(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('ComicVine', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        const offset = await getOffset(KEY, databaseUrl, 0);
        const response = await withRetry(() => axios.get(COMICVINE_URL, {
            params: {
                api_key: apiKey, format: 'json', sort: 'date_added:desc',
                limit, offset, field_list: 'id,name,description,image,start_year,deck,count_of_issues,publisher,site_detail_url'
            }
        }));

        const results = response.data.results || [];
        if (results.length === 0) {
            await setOffset(KEY, 0, databaseUrl);
            log.skip('End of catalog, reset offset 0');
            return 0;
        }

        const externalIds = results.map((r: any) => `cv-${r.id}`);
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        const toInsert = results.filter((r: any) => !existing.has(`cv-${r.id}`));
        if (toInsert.length === 0) {
            log.skip(`ComicVine offset ${offset}: all existing`);
            await setOffset(KEY, offset + limit, databaseUrl);
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

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

        const brainItems = inserted.map(m => ({ id: m.id, type: 'comic' as const }));
        await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

        for (const m of inserted) {
            log.success(`[COMIC] ${m.externalId}`);
        }

        await setOffset(KEY, offset + limit, databaseUrl);
        log.success(`ComicVine: ${inserted.length} added (offset ${offset})`);
        return inserted.length;
    } catch (err: any) {
        log.error(`Comic Vine Error: ${err.message}`);
        throw err;
    }
}
