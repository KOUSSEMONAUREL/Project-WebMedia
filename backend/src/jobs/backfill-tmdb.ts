import 'dotenv/config';
import { getNeonClient } from '../db/singleton';
import { medias } from '../db/neon/schema';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const FRIBB_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';

async function searchTmdb(title: string, type: 'tv' | 'movie', lang: string): Promise<number | null> {
    const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=${lang}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data?.results?.[0]?.id ?? null;
}

async function findTmdbId(title: string): Promise<number | null> {
    let id = await searchTmdb(title, 'tv', 'en-US');
    if (id) return id;
    id = await searchTmdb(title, 'tv', 'fr-FR');
    if (id) return id;
    id = await searchTmdb(title, 'movie', 'en-US');
    if (id) return id;
    id = await searchTmdb(title, 'movie', 'fr-FR');
    return id ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
type FribbEntry = { anilist_id?: number | string; themoviedb_id?: number | { tv?: number; movie?: number } };

function extractTmdbFromFribb(entry: FribbEntry): number | null {
    if (!entry.themoviedb_id) return null;
    if (typeof entry.themoviedb_id === 'number') return entry.themoviedb_id;
    return entry.themoviedb_id.tv ?? entry.themoviedb_id.movie ?? null;
}

async function fetchFribbMapping(): Promise<Map<string, number>> {
    const res = await fetch(FRIBB_URL);
    if (!res.ok) return new Map();
    const data = await res.json() as FribbEntry[];
    const map = new Map<string, number>();
    for (const entry of data) {
        const id = extractTmdbFromFribb(entry);
        if (entry.anilist_id && id) {
            map.set(String(entry.anilist_id), id);
        }
    }
    return map;
}

async function backfill() {
    console.log('Backfilling TMDB IDs for anime...');

    const neonUrl = process.env.NEON_DATABASE_URL || '';
    if (!neonUrl) throw new Error('NEON_DATABASE_URL is missing');
    if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY is missing');

    const { db, client: pgClient } = getNeonClient(neonUrl);

    const rows = await db.select({
        id: medias.id,
        anilistId: medias.anilistId,
        title: medias.title,
    })
        .from(medias)
        .where(and(
            isNotNull(medias.anilistId),
            isNull(medias.tmdbId),
        ))
        .limit(parseInt(process.env.LIMIT || '500', 10));

    console.log(`Found ${rows.length} anime without TMDB ID`);

    if (rows.length === 0) {
        console.log('Nothing to do.');
        await pgClient.end();
        process.exit(0);
    }

    console.log('Fetching Fribb mapping (fallback for TMDB search misses)...');
    const fribbMap = await fetchFribbMapping();
    console.log(`Fribb: ${fribbMap.size} entries loaded`);

    let updated = 0;
    let notFound = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const title = row.title || `Anime ${row.anilistId}`;

        try {
            // 1) TMDB search
            let tmdbId = await findTmdbId(title);

            // 2) Fribb fallback
            if (!tmdbId && row.anilistId) {
                tmdbId = fribbMap.get(String(row.anilistId)) ?? null;
                if (tmdbId) console.log(`  Fribb fallback for ${title} -> TMDB ${tmdbId}`);
            }

            if (tmdbId) {
                await db.update(medias)
                    .set({ tmdbId, metadataSource: 'tmdb' })
                    .where(eq(medias.id, row.id));
                updated++;
                console.log(`[${i + 1}/${rows.length}] OK  ${title} -> TMDB ${tmdbId}`);
            } else {
                notFound++;
                console.warn(`[${i + 1}/${rows.length}] --  ${title} -> not found`);
            }
        } catch (err: any) {
            console.error(`[${i + 1}/${rows.length}] ERR ${title}: ${err.message}`);
        }
    }

    console.log(`\nDone. Updated: ${updated}, Not found: ${notFound}, Total: ${rows.length}`);

    await pgClient.end();
    process.exit(0);
}

backfill().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
