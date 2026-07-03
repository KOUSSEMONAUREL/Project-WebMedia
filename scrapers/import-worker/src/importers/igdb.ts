import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

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
    const log = createLog('IGDB', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        const offset = await getOffset(KEY, databaseUrl, 0);
        const token = await getTwitchToken(clientId, clientSecret);

        const response = await withRetry(() => axios.post(IGDB_URL,
            `fields name,summary,cover.url,first_release_date,total_rating,aggregated_rating,genres.name,themes.name,platforms.name,game_modes.name,player_perspectives.name,screenshots.url,videos.video_id,websites.*,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,similar_games.name,storyline,franchise.name,game_engines.name; sort total_rating desc; limit ${limit}; offset ${offset}; where total_rating != null;`,
            { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` } }
        ));

        const results = response.data || [];
        if (results.length === 0) {
            await setOffset(KEY, 0, databaseUrl);
            log.skip('End of catalog, reset offset 0');
            return 0;
        }

        const igdbIds = results.map((r: any) => r.id);
        const existing = await batchCheckExisting(db, medias.igdbId, igdbIds);

        const toInsert = results.filter((r: any) => !existing.has(r.id));
        if (toInsert.length === 0) {
            log.skip(`IGDB offset ${offset}: all existing`);
            await setOffset(KEY, offset + limit, databaseUrl);
            return 0;
        }

        const mediaValues = toInsert.map((item: any) => {
            const genres = (item.genres || []).map((g: any) => g.name);
            const themes = (item.themes || []).map((g: any) => g.name);
            const platforms = (item.platforms || []).map((p: any) => p.name);
            const modes = (item.game_modes || []).map((m: any) => m.name);
            const perspectives = (item.player_perspectives || []).map((p: any) => p.name);
            const dev = (item.involved_companies || [])
                .filter((c: any) => c.developer)
                .map((c: any) => c.company?.name)
                .filter(Boolean);
            const pub = (item.involved_companies || [])
                .filter((c: any) => c.publisher)
                .map((c: any) => c.company?.name)
                .filter(Boolean);
            const allStudios = [...new Set([...dev, ...pub])];
            const screenshot = item.screenshots?.[0]?.url
                ? `https:${item.screenshots[0].url.replace('t_thumb', 't_screenshot_big')}`
                : undefined;
            const trailer = item.videos?.[0]?.video_id || undefined;
            const similar = (item.similar_games || []).map((s: any) => s.name);

            return {
                type: 'game', title: item.name,
                synopsis: item.storyline || item.summary,
                year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : undefined,
                posterUrl: item.cover?.url ? `https:${item.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
                backdropUrl: screenshot,
                rating: item.total_rating ? (item.total_rating / 10).toString() : "0",
                voteCount: item.aggregated_rating ? Math.round(item.aggregated_rating) : undefined,
                igdbId: item.id, externalId: `igdb-${item.id}`,
                slug: item.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, ''),
                genres: genres.length ? JSON.stringify([...new Set([...genres, ...themes])]) : undefined,
                trailerUrl: trailer || undefined,
                studios: allStudios.length ? JSON.stringify(allStudios) : undefined,
                tagline: item.franchise?.name ? `Franchise ${item.franchise.name}` : undefined,
                metadataSource: 'igdb', metadataFreshAt: new Date(),
            };
        });

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, igdbId: medias.igdbId }) as any;

        const brainItems = inserted.map((m: any) => ({ id: m.id, type: 'game' as const }));
        await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

        for (const m of inserted) {
            log.success(`[GAME] IGDB#${m.igdbId}`);
        }

        await setOffset(KEY, offset + limit, databaseUrl);
        log.success(`IGDB: ${inserted.length} added (offset ${offset})`);
        return inserted.length;
    } catch (error) {
        log.error(`IGDB Import Error: ${error}`);
        throw error;
    }
}
