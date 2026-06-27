import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const IGDB_URL = 'https://api.igdb.com/v4/games';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const KEY = 'igdb';

async function getTwitchToken(clientId: string, clientSecret: string) {
    const response = await withRetry(() => axios.post(TWITCH_TOKEN_URL, null, {
        params: { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }
    }));
    return response.data.access_token;
}

export async function importTrendingGames(clientId: string, clientSecret: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting IGDB Import (limit=${limit})...`);

    try {
        const offset = await getOffset(KEY, databaseUrl, 0);
        const token = await getTwitchToken(clientId, clientSecret);

        const response = await withRetry(() => axios.post(IGDB_URL,
            `fields name,summary,cover.url,first_release_date,total_rating; sort total_rating desc; limit ${limit}; offset ${offset}; where total_rating != null;`,
            { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } }
        ));

        const results = response.data || [];
        if (results.length === 0) {
            await setOffset(KEY, 0, databaseUrl);
            console.log('📄 Fin catalogue IGDB, retour offset 0');
            return 0;
        }

        const igdbIds = results.map((r: any) => r.id);
        const existing = await batchCheckExisting(db, medias.igdbId, igdbIds);

        const toInsert = results.filter((r: any) => !existing.has(r.id));
        if (toInsert.length === 0) {
            console.log(`📄 IGDB offset ${offset}: tout existant déjà`);
            await setOffset(KEY, offset + limit, databaseUrl);
            return 0;
        }

        const mediaValues = toInsert.map((item: any) => ({
            type: 'game', title: item.name,
            synopsis: item.summary,
            year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : undefined,
            posterUrl: item.cover?.url ? `https:${item.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
            rating: item.total_rating ? (item.total_rating / 10).toString() : "0",
            igdbId: item.id, externalId: `igdb-${item.id}`,
            slug: item.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, ''),
            metadataSource: 'igdb', metadataFreshAt: new Date()
        }));

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, igdbId: medias.igdbId }) as any;

        const brainItems = inserted.map((m: any) => ({ id: m.id, type: 'game' as const }));
        await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

        for (const m of inserted) {
            console.log(`✅ [GAME] IGDB#${m.igdbId}`);
        }

        await setOffset(KEY, offset + limit, databaseUrl);
        console.log(`✅ IGDB: ${inserted.length} ajoutés (offset ${offset})`);
        return inserted.length;
    } catch (error) {
        console.error('IGDB Import Error:', error);
        throw error;
    }
}
