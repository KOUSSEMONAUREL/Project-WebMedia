import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens, episodes } from '../db/neon/schema.js';
import { eq, inArray, and } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, notifyBrainBatch } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

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

export async function importTMDB(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting TMDB Import (limit=${limit})...`);

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

            const items = (response.data.results || []).slice(0, limit);
            if (items.length === 0) {
                await setOffset(catKey, 1, databaseUrl);
                continue;
            }

            const itemKeys = items.map((i: any) => `${category}-${i.id}`);
            const existing = await batchCheckExisting(db, medias.externalId, itemKeys);

            const toInsert = items.filter((i: any) => !existing.has(`${category}-${i.id}`));
            if (toInsert.length === 0) {
                console.log(`📄 TMDB ${category} page ${page}: tout existant déjà`);
                await setOffset(catKey, page + 1, databaseUrl);
                continue;
            }

            const mediaValues = toInsert.map((item: any) => {
                const title = item.title || item.name;
                const mediaType = category.startsWith('movie') ? 'movie' : 'serie';
                const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined;
                return {
                    type: mediaType, title, originalTitle: item.original_title || item.original_name,
                    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
                    synopsis: item.overview, posterUrl, externalId: `${category}-${item.id}`,
                    tmdbId: item.id,
                    year: item.release_date ? parseInt(item.release_date) : (item.first_air_date ? parseInt(item.first_air_date) : null),
                    metadataSource: 'tmdb', metadataFreshAt: new Date(),
                };
            });

            const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

            const brainItems = inserted
                .filter(m => m.externalId)
                .map(m => ({ id: m.id, type: m.externalId!.startsWith('movie') ? 'movie' : 'serie' as const }));
            await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

            for (const m of inserted) {
                if (!m.externalId) continue;
                const mediaType = m.externalId.startsWith('movie') ? 'movie' : 'serie';
                console.log(`✅ [${mediaType.toUpperCase()}] ${m.externalId}`);
            }

            totalImported += inserted.length;
            await setOffset(catKey, page + 1, databaseUrl);
        } catch (err: any) {
            console.error(`TMDB Error for ${category}:`, err.message);
        }
    }

    console.log(`✅ TMDB: ${totalImported} ajoutés`);
    return totalImported;
}
