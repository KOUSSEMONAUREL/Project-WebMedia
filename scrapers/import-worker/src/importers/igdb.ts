import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const IGDB_URL = 'https://api.igdb.com/v4/games';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const KEY = 'igdb';
// IGDB game_type: 0=GAME, 1=MAIN_GAME, 8=REMAKE, 10=DLC, 11=EXPANSION,
// 12=STANDALONE_EXPANSION, 13=MOD, 14=PACK, 15=UPDATE.
// On ne cree une fiche que pour les vrais jeux (0/1) : les DLC, packs, mods et
// remakes ont une page de liens propre, mais ne doivent pas melanger le catalogue.
const IGDB_MAIN_GAME_TYPES = new Set([0, 1]);
// game_type / parent_game / version_parent : c'est IGDB qui connait
// l'identite reelle d'un jeu (jeu principal, remake, DLC) et son jeu de
// base. Sans ces champs on devine, et on rattache des liens au mauvais jeu.
const IGDB_FIELDS = 'fields id,name,summary,cover.url,first_release_date,total_rating,total_rating_count,aggregated_rating,genres.name,themes.name,platforms.name,game_modes.name,player_perspectives.name,screenshots.url,videos.video_id,websites.*,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,similar_games.name,storyline,franchise.name,game_engines.name,game_type,parent_game.name,version_parent.name';

async function getTwitchToken(clientId: string, clientSecret: string) {
    const response = await withRetry(() => axios.post(TWITCH_TOKEN_URL, null, {
        params: { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }
    }));
    return response.data.access_token;
}

async function igdbPost(url: string, body: string, clientId: string, token: string, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.post(url, body, {
                headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
                timeout: 15000,
            });
        } catch (err: any) {
            if (i === retries - 1 || err?.response?.status !== 429) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

function buildMediaRow(item: any) {
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
    // websites.* etait demande depuis le debut mais jamais lu. category 1 =
    // site officiel: c'est le lien qui permet de verifier a l'utilisateur que
    // le jeu est bien le bon.
    const officialSite = (item.websites || []).find((w: any) => w?.category === 1 && w?.url);
    const storeSite = (item.websites || []).find((w: any) => w?.category === 2 && w?.url);

    return {
        type: 'jeu' as const, title: item.name,
        synopsis: item.storyline || item.summary,
        year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : undefined,
        posterUrl: item.cover?.url ? `https:${item.cover.url.replace('t_thumb', 't_cover_big')}` : undefined,
        backdropUrl: screenshot,
        rating: item.total_rating ? (item.total_rating / 10).toString() : "0",
        // total_rating_count est le nombre de votes. aggregated_rating est une
        // MOYENNE non ponderee : la mettre dans voteCount produisait des
        // "6 votes" et faussait le tri.
        voteCount: typeof item.total_rating_count === 'number' ? item.total_rating_count : undefined,
        igdbId: item.id, externalId: `igdb-${item.id}`,
        gameType: typeof item.game_type === 'number' ? item.game_type : undefined,
        parentGameName: item.parent_game?.name || undefined,
        versionParentName: item.version_parent?.name || undefined,
        slug: item.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, ''),
        genres: genres.length ? JSON.stringify([...new Set([...genres, ...themes])]) : undefined,
        trailerUrl: trailer || undefined,
        studios: allStudios.length ? JSON.stringify(allStudios) : undefined,
        tagline: item.franchise?.name ? `Franchise ${item.franchise.name}` : undefined,
        officialUrl: officialSite?.url || undefined,
        storeUrl: storeSite?.url || undefined,
        metadataSource: 'igdb', metadataFreshAt: new Date(),
    };
}

export async function importTrendingGames(clientId: string, clientSecret: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, internalApiUrl: internalApiUrl ?? undefined, internalApiKey: internalApiKey ?? undefined, databaseUrl };
    let igdbToken = '';

    const config: ScannerConfig = {
        key: KEY,
        name: 'IGDB',
        rateLimit: { requestsPerSecond: 4, maxConcurrent: 1 },
        init: async () => {
            igdbToken = await getTwitchToken(clientId, clientSecret);
        },
        freshness: {
            maxHistoryDays: 7,
            defaultCheckpointAgeMs: 24 * 3600 * 1000,
            fetch: async (fetchLimit: number, checkpoint: string) => {
                const since = Math.floor(new Date(checkpoint).getTime() / 1000);
                const response = await igdbPost(IGDB_URL,
                    `${IGDB_FIELDS}; sort updated_at desc; limit ${fetchLimit}; where updated_at > ${since};`,
                    clientId, igdbToken
                );
                const results = response?.data || [];
                return { items: results, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const igdbIds = items.map((r: any) => r.id);
                const existing = await batchCheckExisting(db, medias.igdbId, igdbIds);
                let affected = 0;

                const toUpdate = items.filter((r: any) => existing.has(r.id));
                for (const item of toUpdate) {
                    const row = buildMediaRow(item);
                    await db.update(medias).set({
                        ...row,
                        externalId: undefined,
                        igdbId: undefined,
                        type: undefined,
                        slug: undefined,
                        metadataFreshAt: new Date(),
                    }).where(eq(medias.igdbId, item.id));
                    affected++;
                }

                const toInsert = items.filter((r: any) => !existing.has(r.id));
                if (toInsert.length > 0) {
                    const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                    const inserted: any[] = await db.insert(medias).values(mediaValues)
                        .onConflictDoNothing()
                        .returning({ id: medias.id, igdbId: medias.igdbId, title: medias.title, slug: medias.slug, parentGameName: medias.parentGameName });

                const brainItems = inserted.map((m: any) => ({ id: m.id, type: 'jeu' as const, title: m.title, slug: m.slug, parentGameName: m.parentGameName }));
                    await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

                    for (const m of inserted) {
                        log.success(`[GAME] IGDB#${m.igdbId}`);
                    }
                    affected += inserted.length;
                }

                if (affected > 0) log.info(`Freshness: ${affected} affected`);
                return affected;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: limit,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const response = await igdbPost(IGDB_URL,
                    `${IGDB_FIELDS}; sort total_rating desc; limit ${fetchLimit}; offset ${offset}; where total_rating != null;`,
                    clientId, igdbToken
                );
                const results = response?.data || [];
                return { items: results, hasMore: results.length === fetchLimit };
            },
            getTotal: () => 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const mainGames = items.filter((r: any) => IGDB_MAIN_GAME_TYPES.has(r.game_type ?? 0));
                const dropped = items.length - mainGames.length;
                if (dropped > 0) log.info(`Ecartes ${dropped} DLC/pack/remake (game_type != jeu principal)`);
                const igdbIds = mainGames.map((r: any) => r.id);
                const existing = await batchCheckExisting(db, medias.igdbId, igdbIds);
                const toInsert = mainGames.filter((r: any) => !existing.has(r.id));
                if (toInsert.length === 0) {
                    log.skip('IGDB: all existing');
                    return 0;
                }

                const mediaValues = toInsert.map((item: any) => buildMediaRow(item));
                const inserted: any[] = await db.insert(medias).values(mediaValues)
                    .onConflictDoNothing()
                    .returning({ id: medias.id, igdbId: medias.igdbId, title: medias.title, slug: medias.slug, parentGameName: medias.parentGameName });

                const brainItems = inserted.map((m: any) => ({ id: m.id, type: 'jeu' as const, title: m.title, slug: m.slug, parentGameName: m.parentGameName }));
                await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

                for (const m of inserted) {
                    log.success(`[GAME] IGDB#${m.igdbId}`);
                }
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
