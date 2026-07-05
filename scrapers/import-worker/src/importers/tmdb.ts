import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens, episodes } from '../db/neon/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, notifyBrainBatch } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const KEY = 'tmdb';

async function fetchWithRetry(url: string, params: Record<string, any>, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await axios.get(url, { params, timeout: 10000 });
        } catch (err: any) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function fetchGenreMap(apiKey: string): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    for (const mediaType of ['movie', 'tv']) {
        try {
            const res = await fetchWithRetry(`${TMDB_API_BASE}/genre/${mediaType}/list`, {
                api_key: apiKey, language: 'fr-FR'
            });
            for (const g of res?.data?.genres || []) {
                map.set(g.id, g.name);
            }
        } catch { /* skip */ }
    }
    return map;
}

async function fetchMediaDetails(apiKey: string, tmdbId: number, category: string) {
    try {
        const isMovie = category.startsWith('movie');
        const res = await fetchWithRetry(`${TMDB_API_BASE}/${isMovie ? 'movie' : 'tv'}/${tmdbId}`, {
            api_key: apiKey, language: 'fr-FR', append_to_response: 'videos,credits,external_ids'
        });
        if (!res) return null;

        const d = res.data;
        const trailer = (d.videos?.results || []).find(
            (v: any) => v.type === 'Trailer' && v.site === 'YouTube' && v.official !== false
        ) || (d.videos?.results || []).find(
            (v: any) => v.type === 'Trailer' && v.site === 'YouTube'
        );

        return {
            backdropUrl: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null,
            tagline: d.tagline || null,
            status: d.status || null,
            imdbId: d.external_ids?.imdb_id || null,
            trailerUrl: trailer?.key || null,
            studios: d.production_companies?.length
                ? JSON.stringify(d.production_companies.map((c: any) => c.name))
                : null,
            voteAverage: d.vote_average || null,
            voteCount: d.vote_count || null,
        };
    } catch { return null; }
}

async function importEpisodesForSerie(db: any, apiKey: string, tmdbId: number, mediaId: string, log: ReturnType<typeof createLog>) {
    try {
        const detailRes = await fetchWithRetry(`${TMDB_API_BASE}/tv/${tmdbId}`, {
            api_key: apiKey, language: 'fr-FR'
        });
        if (!detailRes) return;

        const seasons: any[] = (detailRes.data.seasons || []).filter((s: any) => s.season_number > 0);

        for (const season of seasons) {
            const seasonNum = season.season_number;
            const epRes = await fetchWithRetry(`${TMDB_API_BASE}/tv/${tmdbId}/season/${seasonNum}`, {
                api_key: apiKey, language: 'fr-FR'
            });
            if (!epRes) continue;

            const epItems: any[] = epRes.data.episodes || [];
            if (epItems.length === 0) continue;

            const episodeValues = epItems.map((ep: any) => ({
                mediaId,
                seasonNumber: seasonNum,
                episodeNumber: ep.episode_number,
                title: ep.name,
                synopsis: ep.overview,
                airDate: ep.air_date ? new Date(ep.air_date) : null,
                thumbnailUrl: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
                duration: ep.runtime || null,
            }));

            await db.insert(episodes).values(episodeValues).onConflictDoNothing();
            log.info(`S${seasonNum}: ${epItems.length} episodes`);
        }
    } catch (err: any) {
        log.warn(`Episode error for TMDB ${tmdbId}: ${err.message}`);
    }
}

export async function importTMDB(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('TMDB', 'one-shot');
    log.start(`Import (limit=${limit})`);

    const genreMap = await fetchGenreMap(apiKey);
    log.info(`Genre map: ${genreMap.size} genres loaded`);

    const categories = ['movie/popular', 'tv/popular'];
    let totalImported = 0;

    for (const category of categories) {
        const catKey = `${KEY}:${category}`;
        let page = await getOffset(catKey, databaseUrl, 1);

        try {
            const response = await fetchWithRetry(`${TMDB_API_BASE}/${category}`, {
                api_key: apiKey, language: 'fr-FR', page, region: 'FR'
            });
            if (!response) continue;

            const items = response.data.results || [];
            if (items.length === 0) {
                await setOffset(catKey, 1, databaseUrl);
                continue;
            }

            const itemKeys = items.map((i: any) => `${category}-${i.id}`);
            const existing = await batchCheckExisting(db, medias.externalId, itemKeys);

            const toInsert = items.filter((i: any) => !existing.has(`${category}-${i.id}`));
            if (toInsert.length === 0) {
                log.skip(`TMDB ${category} page ${page}: all existing`);
                await setOffset(catKey, page + 1, databaseUrl);
                continue;
            }

            const mediaValues = toInsert.map((item: any) => {
                const title = item.title || item.name;
                const mediaType = category.startsWith('movie') ? 'movie' : 'serie';
                const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined;
                const backdropUrl = item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined;
                const genreNames = (item.genre_ids || [])
                    .map((id: number) => genreMap.get(id))
                    .filter(Boolean);

                return {
                    type: mediaType, title, originalTitle: item.original_title || item.original_name,
                    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
                    synopsis: item.overview, posterUrl, backdropUrl,
                    externalId: `${category}-${item.id}`, tmdbId: item.id,
                    year: item.release_date ? parseInt(item.release_date) : (item.first_air_date ? parseInt(item.first_air_date) : null),
                    rating: item.vote_average ? String(Math.round(item.vote_average * 10) / 10) : undefined,
                    voteCount: item.vote_count || 0,
                    genres: genreNames.length ? JSON.stringify(genreNames) : undefined,
                    metadataSource: 'tmdb', metadataFreshAt: new Date(),
                    episode_count: mediaType === 'serie' ? (item.original_language === 'ja' || !!item.origin_country?.includes('JP') ? undefined : undefined) : undefined,
                };
            });

            const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, tmdbId: medias.tmdbId, title: medias.title, slug: medias.slug });

            for (const m of inserted) {
                if (!m.tmdbId) continue;
                if (m.externalId?.startsWith('tv')) {
                    log.info(`Importing episodes for ${m.externalId}`);
                    await importEpisodesForSerie(db, apiKey, m.tmdbId, m.id, log);
                }
                const details = await fetchMediaDetails(apiKey, m.tmdbId, m.externalId || '');
                if (details) {
                    const update: any = {};
                    if (details.backdropUrl) update.backdropUrl = details.backdropUrl;
                    if (details.tagline) update.tagline = details.tagline;
                    if (details.status) update.status = details.status;
                    if (details.imdbId) update.imdbId = details.imdbId;
                    if (details.trailerUrl) update.trailerUrl = details.trailerUrl;
                    if (details.studios) update.studios = details.studios;
                    if (details.voteAverage !== null) update.rating = String(Math.round(details.voteAverage * 10) / 10);
                    if (details.voteCount !== null) update.voteCount = details.voteCount;
                    if (Object.keys(update).length > 0) {
                        await db.update(medias).set(update).where(eq(medias.id, m.id));
                    }
                }
            }

            const brainItems = inserted
                .filter(m => m.externalId)
                .map(m => ({ id: m.id, type: m.externalId!.startsWith('movie') ? 'movie' : 'serie' as const, title: m.title, slug: m.slug }));
            await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

            for (const m of inserted) {
                if (!m.externalId) continue;
                const mediaType = m.externalId.startsWith('movie') ? 'movie' : 'serie';
                log.success(`[${mediaType.toUpperCase()}] ${m.externalId}`);
            }

            totalImported += inserted.length;
            await setOffset(catKey, page + 1, databaseUrl);
        } catch (err: any) {
            log.error(`TMDB Error for ${category}: ${err.message}`);
        }
    }

    log.success(`TMDB: ${totalImported} added`);
    return totalImported;
}
