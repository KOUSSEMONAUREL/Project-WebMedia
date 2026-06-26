import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import axios from 'axios';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const ANILIST_API = 'https://graphql.anilist.co';
const KEY = 'anilist';

const POPULAR_QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(sort: POPULARITY_DESC, type: ANIME) {
        id idMal title { romaji english native } format episodes
        description coverImage { large } genres averageScore startDate { year }
      }
    }
  }
`;

export async function importAnime(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting AniList Import (limit=${limit})...`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const response = await withRetry(() => axios.post(ANILIST_API, {
            query: POPULAR_QUERY,
            variables: { page, perPage: limit }
        }, { headers: { 'User-Agent': 'WebMedia/1.0' } }));

        const entries = response.data?.data?.Page?.media || [];
        if (entries.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            console.log('📄 Fin catalogue AniList, retour page 1');
            return 0;
        }

        const externalIds = entries.map((m: any) => `al-${m.id}`);
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        const toInsert = entries.filter((e: any) => !existing.has(`al-${e.id}`));
        if (toInsert.length === 0) {
            console.log(`📄 AniList page ${page}: tout existant déjà`);
            await setOffset(KEY, page + 1, databaseUrl);
            return 0;
        }

        const mediaValues = toInsert.map((entry: any) => {
            const title = entry.title?.romaji || entry.title?.english || entry.title?.native || 'Unknown';
            const synopsis = entry.description?.replace(/<[^>]*>/g, '').slice(0, 2000);
            return {
                type: 'anime', title, originalTitle: entry.title?.native,
                slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
                synopsis, posterUrl: entry.coverImage?.large,
                externalId: `al-${entry.id}`, year: entry.startDate?.year,
                metadataSource: 'anilist', metadataFreshAt: new Date()
            };
        });

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

        for (const m of inserted) {
            console.log(`✅ [ANIME] ${m.externalId}`);
        }

        await setOffset(KEY, page + 1, databaseUrl);
        console.log(`✅ AniList: ${inserted.length} ajoutés (page ${page})`);
        return inserted.length;
    } catch (error: any) {
        console.error('AniList Import Error:', error.message);
        throw error;
    }
}
