import 'dotenv/config';
import { getNeonClient } from '../db/singleton';
import { medias } from '../db/neon/schema';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_SEARCH_URL = 'https://api.themoviedb.org/3/search/tv';

async function backfill() {
    console.log('Backfilling TMDB IDs for anime...');

    const neonUrl = process.env.NEON_DATABASE_URL || '';
    if (!neonUrl) throw new Error('NEON_DATABASE_URL is missing');
    if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY is missing');

    const { db } = getNeonClient(neonUrl);

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

    let updated = 0;
    let notFound = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const title = row.title || `Anime ${row.anilistId}`;

        try {
            const res = await fetch(
                `${TMDB_SEARCH_URL}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=fr-FR`
            );
            if (!res.ok) {
                console.warn(`[${i + 1}/${rows.length}] TMDB error ${res.status} for ${title}`);
                continue;
            }
            const data = await res.json() as any;
            const found = data?.results?.[0];
            if (found?.id) {
                await db.update(medias)
                    .set({ tmdbId: found.id, metadataSource: 'tmdb' })
                    .where(eq(medias.id, row.id));
                updated++;
                console.log(`[${i + 1}/${rows.length}] OK  ${title} -> TMDB ${found.id}`);
            } else {
                notFound++;
                console.warn(`[${i + 1}/${rows.length}] --  ${title} -> not found on TMDB`);
            }
        } catch (err: any) {
            console.error(`[${i + 1}/${rows.length}] ERR ${title}: ${err.message}`);
        }
    }

    console.log(`\nDone. Updated: ${updated}, Not found: ${notFound}, Total: ${rows.length}`);
}

backfill().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
});
