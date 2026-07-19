import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import axios from 'axios';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

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

async function processAnilistPage(db: any, pageNum: number, limit: number, log: ReturnType<typeof createLog>): Promise<number> {
    const response = await withRetry(() => axios.post(ANILIST_API, {
        query: POPULAR_QUERY,
        variables: { page: pageNum, perPage: limit }
    }, { headers: { 'User-Agent': 'WebMedia/1.0' } }));

    const entries = response.data?.data?.Page?.media || [];
    if (entries.length === 0) return 0;

    const externalIds = entries.map((m: any) => `al-${m.id}`);
    const existing = await batchCheckExisting(db, medias.externalId, externalIds);

    const toInsert = entries.filter((e: any) => !existing.has(`al-${e.id}`));
    if (toInsert.length === 0) {
        log.skip(`AniList page ${pageNum}: all existing`);
        return 0;
    }

    const mediaValues = toInsert.map((entry: any) => {
        const title = entry.title?.romaji || entry.title?.english || entry.title?.native || 'Unknown';
        const synopsis = entry.description?.replace(/<[^>]*>/g, '').slice(0, 2000);
        const genreNames = entry.genres || [];
        const studios = entry.studios?.nodes?.length
            ? JSON.stringify(entry.studios.nodes.map((s: any) => s.name))
            : undefined;
        const trailerUrl = entry.trailer?.site === 'youtube' ? entry.trailer.id : undefined;
        const seasonStr = entry.season && entry.seasonYear
            ? `${entry.season}-${entry.seasonYear}`
            : undefined;

        return {
            type: 'anime', title, originalTitle: entry.title?.native,
            slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
            synopsis, posterUrl: entry.coverImage?.extraLarge || entry.coverImage?.large,
            backdropUrl: entry.bannerImage || undefined,
            externalId: `al-${entry.id}`, anilistId: entry.id, malId: entry.idMal || undefined,
            year: entry.startDate?.year,
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
    });

    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

    for (const m of inserted) {
        log.success(`[ANIME] ${m.externalId}`);
        try {
            await notifyBrain(m.id, 'anime', process.env.INTERNAL_API_URL!, process.env.INTERNAL_API_KEY!, m.title, m.slug);
        } catch { /* ignore brain errors */ }
    }

    log.success(`AniList: ${inserted.length} added (page ${pageNum})`);
    return inserted.length;
}

export async function importAnime(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('AniList', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);

        // Freshness pass: always check page 1 for newly popular anime
        let freshCount = 0;
        if (page > 1) {
            try {
                freshCount = await processAnilistPage(db, 1, limit, log);
                if (freshCount > 0) log.info(`Freshness: ${freshCount} new anime`);
            } catch (err: any) {
                log.warn(`Freshness pass failed: ${err.message}`);
            }
        }

        // Deep pass: continue from stored page
        const deepCount = await processAnilistPage(db, page, limit, log);
        await setOffset(KEY, page + 1, databaseUrl);
        return deepCount + freshCount;
    } catch (error: any) {
        log.error(`AniList Import Error: ${error.message}`);
        throw error;
    }
}
