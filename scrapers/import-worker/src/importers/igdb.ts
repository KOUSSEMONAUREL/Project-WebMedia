import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const IGDB_URL = 'https://api.igdb.com/v4/games';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const KEY = 'igdb';

async function getTwitchToken(clientId: string, clientSecret: string) {
    const response = await axios.post(TWITCH_TOKEN_URL, null, {
        params: { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }
    });
    return response.data.access_token;
}

export async function importTrendingGames(clientId: string, clientSecret: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting IGDB Import (limit=${limit})...`);

    try {
        const offset = await getOffset(KEY, databaseUrl, 0);
        const token = await getTwitchToken(clientId, clientSecret);

        const response = await axios.post(IGDB_URL,
            `fields name,summary,cover.url,first_release_date,total_rating; sort total_rating desc; limit ${limit}; offset ${offset}; where total_rating != null;`,
            { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } }
        );

        const results = response.data || [];
        if (results.length === 0) {
            await setOffset(KEY, 0, databaseUrl);
            console.log('📄 Fin catalogue IGDB, retour offset 0');
            return 0;
        }

        const igdbIds = results.map((r: any) => r.id);
        const existing = await batchCheckExisting(db, medias.igdbId, igdbIds);

        let importedCount = 0;
        for (const item of results) {
            if (existing.has(item.id)) continue;

            const title = item.name;
            try {
                const inserted: { id: string }[] = await db.insert(medias).values({
                    type: 'game', title,
                    synopsis: item.summary,
                    year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : undefined,
                    posterUrl: item.cover?.url ? `https:${item.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
                    rating: item.total_rating ? (item.total_rating / 10).toString() : "0",
                    igdbId: item.id, slug: title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, ''),
                    metadataSource: 'igdb', metadataFreshAt: new Date()
                }).returning({ id: medias.id }) as any;

                if (inserted[0]) {
                    await notifyBrain(inserted[0].id, 'game', internalApiUrl!, internalApiKey!);
                    importedCount++;
                }
            } catch {}
        }

        await setOffset(KEY, offset + limit, databaseUrl);
        console.log(`✅ IGDB: ${importedCount} ajoutés (offset ${offset})`);
        return importedCount;
    } catch (error) {
        console.error('IGDB Import Error:', error);
        throw error;
    }
}
