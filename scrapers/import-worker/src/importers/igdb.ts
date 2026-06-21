import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';

const IGDB_URL = 'https://api.igdb.com/v4/games';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';


async function getTwitchToken(clientId: string, clientSecret: string) {
    const response = await axios.post(TWITCH_TOKEN_URL, null, {
        params: {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        }
    });
    return response.data.access_token;
}

export async function importTrendingGames(clientId: string, clientSecret: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null) {
    const db = createDbClient(databaseUrl, 'neon');

    try {
        console.log('Fetching trending games from IGDB...');
        const token = await getTwitchToken(clientId, clientSecret);

        const response = await axios.post(IGDB_URL,
            'fields name,summary,cover.url,first_release_date,total_rating; sort total_rating desc; limit 20; where total_rating != null;',
            {
                headers: {
                    'Client-ID': clientId,
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        const results = response.data;
        let importedCount = 0;

        for (const item of results) {
            const igdbId = item.id;
            const title = item.name;
            const slug = title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');

            // 1. Vérifier si existe déjà
            const existing = await db.select().from(medias).where(eq(medias.igdbId, igdbId)).limit(1);

            let mediaId: string;

            if (existing.length === 0) {
                const inserted = await db.insert(medias).values({
                    type: 'game',
                    title,
                    synopsis: item.summary,
                    year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : undefined,
                    posterUrl: item.cover?.url ? `https:${item.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
                    rating: item.total_rating ? (item.total_rating / 10).toString() : "0",
                    igdbId: igdbId,
                    slug,
                    metadataSource: 'igdb',
                    metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                mediaId = inserted[0].id;
                importedCount++;
            } else {
                mediaId = existing[0].id;
            }

            // 2. Sync CERVEAU D1
            if (mediaId && internalApiUrl && internalApiKey) {
                try {
                    await axios.post(`${internalApiUrl}/ingest/media`, {
                        id: mediaId,
                        type: 'game',
                        metadata_ok: 1
                    }, {
                        headers: { 'X-Internal-API-Key': internalApiKey }
                    });
                } catch (err) {
                    console.error(`Failed to sync ${mediaId} to D1:`, err);
                }
            }
        }

        console.log(`✅ Import Jeux terminé : ${importedCount} nouveaux jeux ajoutés.`);
        return importedCount;
    } catch (error) {
        console.error('IGDB Import Error:', error);
        throw error;
    }
}
