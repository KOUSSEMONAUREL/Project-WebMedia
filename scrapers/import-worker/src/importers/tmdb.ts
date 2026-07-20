import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, episodes } from '../db/neon/schema.js';
import { eq, and } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch } from '../utils/batch-import.js';
import { runScanner, TokenBucket } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import { createLog } from '../utils/log.js';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const KEY = 'tmdb';

function toDateParam(iso: string): string {
  return iso.slice(0, 10);
}

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

function buildMediaRow(item: any, category: string, genreMap: Map<number, string>) {
    const title = item.title || item.name;
    const isJapanese = item.original_language === 'ja';
    const isChinese = item.original_language === 'zh';
    const isAnimeLang = isJapanese || isChinese;
    const mediaType = category.startsWith('movie') ? 'film' : (isAnimeLang ? 'anime' : 'serie');
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
    };
}

async function updateMediaDetails(
  db: any, apiKey: string, tmdbId: number, mediaType: string, log: ReturnType<typeof createLog>
) {
    const cat = mediaType === 'film' ? 'movie' : 'tv';
    const details = await fetchMediaDetails(apiKey, tmdbId, cat);
    if (!details) return;

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
        await db.update(medias).set(update).where(and(
            eq(medias.tmdbId, tmdbId),
            eq(medias.type, mediaType)
        ));
    }
}

export async function importTMDB(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, internalApiUrl: internalApiUrl ?? undefined, internalApiKey: internalApiKey ?? undefined, databaseUrl };
    const genreMap = await fetchGenreMap(apiKey);

    const config: ScannerConfig = {
        key: KEY,
        name: 'TMDB',
        rateLimit: { requestsPerSecond: 40, maxConcurrent: 4 },
        freshness: {
            maxHistoryDays: 14,
            fetch: async (_fetchLimit: number, checkpoint: string) => {
                const startDate = toDateParam(checkpoint);
                const changedIds: { id: number; isMovie: boolean }[] = [];

                for (const endpoint of ['movie', 'tv']) {
                    try {
                        const res = await axios.get(`${TMDB_API_BASE}/${endpoint}/changes`, {
                            params: { api_key: apiKey, start_date: startDate, page: 1 },
                            timeout: 10000,
                        });
                        const results: { id: number }[] = res.data?.results || [];
                        for (const r of results) {
                            changedIds.push({ id: r.id, isMovie: endpoint === 'movie' });
                        }
                    } catch (err: any) {
                        console.warn(`TMDB /${endpoint}/changes failed: ${err.message}`);
                    }
                }

                if (changedIds.length === 0) {
                    return { items: [], nextCheckpoint: new Date().toISOString() };
                }

                const existing = await batchCheckExisting(db, medias.tmdbId, changedIds.map(c => c.id));
                const known = changedIds.filter(c => existing.has(c.id));

                if (known.length === 0) {
                    return { items: [], nextCheckpoint: new Date().toISOString() };
                }

                const bucket = new TokenBucket({ requestsPerSecond: 40, maxConcurrent: 4 });
                const items: any[] = [];
                const promises = known.map(c =>
                    bucket.withAcquire(async () => {
                        try {
                            const ep = c.isMovie ? 'movie' : 'tv';
                            const res = await axios.get(`${TMDB_API_BASE}/${ep}/${c.id}`, {
                                params: { api_key: apiKey, language: 'fr-FR' },
                                timeout: 10000,
                            });
                            items.push({ ...res.data, _category: c.isMovie ? 'movie' : 'tv' });
                        } catch { /* skip if deleted */ }
                    })
                );
                await Promise.allSettled(promises);

                return { items, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                let updated = 0;
                for (const item of items) {
                    const cat = item._category === 'movie' ? 'movie' : 'tv';
                    const mediaType = cat === 'movie' ? 'film' : 'serie';

                    try {
                        await db.update(medias).set({
                            rating: item.vote_average ? String(Math.round(item.vote_average * 10) / 10) : undefined,
                            voteCount: item.vote_count || 0,
                            genres: (item.genre_ids || [])
                                .map((id: number) => genreMap.get(id))
                                .filter(Boolean)
                                .length > 0
                                ? JSON.stringify((item.genre_ids || []).map((id: number) => genreMap.get(id)).filter(Boolean))
                                : undefined,
                            posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
                            backdropUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
                            synopsis: item.overview,
                            metadataFreshAt: new Date(),
                        }).where(and(
                            eq(medias.tmdbId, item.id),
                            eq(medias.type, mediaType)
                        ));

                        if (cat === 'tv') {
                            const existingMedia = await db.select({ id: medias.id })
                                .from(medias)
                                .where(and(eq(medias.tmdbId, item.id), eq(medias.type, mediaType)))
                                .limit(1);
                            if (existingMedia[0]) {
                                await importEpisodesForSerie(db, apiKey, item.id, existingMedia[0].id, log);
                            }
                        }

                        await updateMediaDetails(db, apiKey, item.id, mediaType, log);
                        updated++;
                    } catch (err: any) {
                        log.warn(`Freshness update failed for TMDB ${item.id}: ${err.message}`);
                    }
                }
                return updated;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: 1,
            fetchPage: async (offset: number, _fetchLimit: number): Promise<FetchResult> => {
                const categories = ['movie/popular', 'tv/popular'];
                const slot = offset % (categories.length * 500);
                const pageNum = Math.floor(slot / categories.length) + 1;
                const catIdx = slot % categories.length;
                const category = categories[catIdx];

                const response = await fetchWithRetry(`${TMDB_API_BASE}/${category}`, {
                    api_key: apiKey, language: 'fr-FR', page: pageNum, region: 'FR'
                });

                if (!response) return { items: [], total: 0 };

                const items = (response.data.results || []).map((r: any) => ({
                    ...r,
                    _category: category,
                }));

                return {
                    items,
                    total: categories.length * 500,
                    hasMore: pageNum < (response.data.total_pages || 0),
                };
            },
            getTotal: (result: FetchResult) => result.total || 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;

                const categories = ['movie/popular', 'tv/popular'];
                let totalInserted = 0;

                for (const category of categories) {
                    const catItems = items.filter((i: any) => i._category === category);
                    if (catItems.length === 0) continue;

                    const itemKeys = catItems.map((i: any) => `${category}-${i.id}`);
                    const existing = await batchCheckExisting(db, medias.externalId, itemKeys);

                    const toInsert = catItems.filter((i: any) => !existing.has(`${category}-${i.id}`));
                    if (toInsert.length === 0) {
                        log.skip(`TMDB ${category}: all existing`);
                        continue;
                    }

                    const mediaValues = toInsert.map((item: any) => buildMediaRow(item, category, genreMap));

                    const inserted: any[] = await db.insert(medias).values(mediaValues)
                        .onConflictDoNothing()
                        .returning({ id: medias.id, externalId: medias.externalId, tmdbId: medias.tmdbId, title: medias.title, slug: medias.slug });

                    for (const m of inserted) {
                        if (!m.tmdbId) continue;
                        if (m.externalId?.startsWith('tv')) {
                            log.info(`Importing episodes for ${m.externalId}`);
                            await importEpisodesForSerie(db, apiKey, m.tmdbId, m.id, log);
                        }
                        await updateMediaDetails(db, apiKey, m.tmdbId, m.externalId!.startsWith('movie') ? 'film' : 'serie', log);
                    }

                    const brainItems = inserted
                        .filter(m => m.externalId)
                        .map(m => ({ id: m.id, type: (m.externalId!.startsWith('movie') ? 'film' as const : 'serie' as const), title: m.title, slug: m.slug }));
                    await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

                    for (const m of inserted) {
                        if (!m.externalId) continue;
                        const mediaType = m.externalId.startsWith('movie') ? 'film' : 'serie';
                        log.success(`[${mediaType.toUpperCase()}] ${m.externalId}`);
                    }

                    totalInserted += inserted.length;
                }

                return totalInserted;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
