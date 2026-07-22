import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const ANILIST_API = 'https://graphql.anilist.co';
const KEY = 'anilist';

const POPULAR_QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(sort: POPULARITY_DESC, type: ANIME) {
        id idMal title { romaji english native }
        format episodes duration status season seasonYear
        description coverImage { extraLarge large }
        genres averageScore popularity
        studios { nodes { name } }
        trailer { id site }
        bannerImage
        tags { name rank }
        nextAiringEpisode { episode airingAt }
      }
    }
  }
`;


function buildMediaRow(entry: any) {
    const title = entry.title?.romaji || entry.title?.english || entry.title?.native || 'Unknown';
    const synopsis = entry.description?.replace(/<[^>]*>/g, '').slice(0, 2000);
    const genreNames = entry.genres || [];
    const studios = entry.studios?.nodes?.length
        ? JSON.stringify(entry.studios.nodes.map((s: any) => s.name))
        : undefined;
    const trailerUrl = entry.trailer?.site === 'youtube' ? entry.trailer.id : undefined;

    return {
        type: 'anime' as const, title, originalTitle: entry.title?.native,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
        synopsis, posterUrl: entry.coverImage?.extraLarge || entry.coverImage?.large,
        backdropUrl: entry.bannerImage || undefined,
        externalId: `al-${entry.id}`, anilistId: entry.id, malId: entry.idMal || undefined,
        year: entry.seasonYear,
        rating: entry.averageScore ? String((entry.averageScore / 10).toFixed(1)) : undefined,
        voteCount: entry.popularity || 0,
        genres: genreNames.length ? JSON.stringify(genreNames) : undefined,
        status: entry.status || undefined,
        trailerUrl: trailerUrl || undefined,
        duration: entry.duration || undefined,
        episodeCount: entry.episodes || undefined,
        studios,
        metadataSource: 'anilist', metadataFreshAt: new Date(),
    };
}

export async function importAnime(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, databaseUrl };

    const config: ScannerConfig = {
        key: KEY,
        name: 'AniList',
        rateLimit: { requestsPerSecond: 1, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 3,
            defaultCheckpointAgeMs: 3600 * 1000,
            fetch: async (fetchLimit: number, _checkpoint: string) => {
                const response = await withRetry(() => axios.post(ANILIST_API, {
                    query: POPULAR_QUERY,
                    variables: { page: 1, perPage: fetchLimit }
                }, { headers: { 'User-Agent': 'WebMediia/1.0' }, timeout: 15000 }));

                const entries = response.data?.data?.Page?.media || [];
                return { items: entries, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((m: any) => `al-${m.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                let affected = 0;

                const toUpdate = items.filter((m: any) => existing.has(`al-${m.id}`));
                for (const entry of toUpdate) {
                    const row = buildMediaRow(entry);
                    await db.update(medias).set({ ...row, externalId: undefined, anilistId: undefined, malId: undefined, type: undefined, slug: undefined, metadataFreshAt: new Date() })
                        .where(eq(medias.anilistId, entry.id));
                    affected++;
                }

                const toInsert = items.filter((m: any) => !existing.has(`al-${m.id}`));
                if (toInsert.length > 0) {
                    const mediaValues = toInsert.map((entry: any) => buildMediaRow(entry));
                    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                        .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                    const brainItems = inserted.map((m: any) => ({ id: m.id, type: 'anime' as const, title: m.title, slug: m.slug }));
                    await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                    for (const m of inserted) log.success(`[ANIME] ${m.externalId}`);
                    affected += inserted.length;
                }

                if (affected > 0) log.info(`Freshness: ${affected} affected`);
                return affected;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: 1,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const page = offset || 1;
                const response = await withRetry(() => axios.post(ANILIST_API, {
                    query: POPULAR_QUERY,
                    variables: { page, perPage: fetchLimit }
                }, { headers: { 'User-Agent': 'WebMediia/1.0' }, timeout: 15000 }));

                const entries = response.data?.data?.Page?.media || [];
                const hasNext = response.data?.data?.Page?.pageInfo?.hasNextPage || false;
                return { items: entries, hasMore: hasNext };
            },
            getTotal: () => 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((m: any) => `al-${m.id}`);
                const existing = await batchCheckExisting(db, medias.externalId, ids);
                const toInsert = items.filter((m: any) => !existing.has(`al-${m.id}`));
                if (toInsert.length === 0) {
                    log.skip('AniList: all existing');
                    return 0;
                }

                const mediaValues = toInsert.map((entry: any) => buildMediaRow(entry));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const brainItems = inserted.map((m: any) => ({ id: m.id, type: 'anime' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                for (const m of inserted) log.success(`[ANIME] ${m.externalId}`);
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
