import axios from 'axios';
import postgres from 'postgres';

const FRIBB_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || (process.env.ENVIRONMENT === 'development' ? 'http://localhost:8787/api/internal' : 'https://api.webmedia.com/api/internal');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const NEON_URL = process.env.NEON_DATABASE_URL || '';

export async function updateFribbMapping() {
    console.log('📡 Downloading Fribb mapping data...');

    try {
        const response = await axios.get(FRIBB_URL);
        const data = response.data;

        console.log(`📊 Processing ${data.length} mappings...`);

        // Connexion Neon pour synchroniser tmdb_id dans medias
        const neonSql = NEON_URL ? postgres(NEON_URL, { prepare: false }) : null;

        const BATCH_SIZE = 100;
        for (let i = 0; i < data.length; i += BATCH_SIZE) {
            const batch = data.slice(i, i + BATCH_SIZE).map((item: any) => {
                // Fribb donne themoviedb_id sous forme { tv: 13916 } ou { movie: 13916 } ou directement 13916
                const raw = item.themoviedb_id;
                const tmdb_id = raw !== null && raw !== undefined
                    ? (typeof raw === 'object' ? (raw.tv ?? raw.movie ?? null) : raw)
                    : null;
                return {
                    anilist_id: item.anilist_id,
                    tmdb_id,
                    mal_id: item.mal_id,
                    imdb_id: item.imdb_id
                };
            }).filter((item: any) => item.anilist_id);

            if (batch.length === 0) continue;

            await axios.post(`${INTERNAL_API_URL}/ingest/mapping`, { mappings: batch }, {
                headers: { 'X-Internal-API-Key': INTERNAL_API_KEY }
            });

            // Synchro Neon : mettre à jour tmdb_id dans medias pour les anime
            if (neonSql) {
                const toUpdate = batch.filter((m: any) => m.tmdb_id);
                if (toUpdate.length > 0) {
                    const anilistIds = toUpdate.map((m: any) => Number(m.anilist_id));
                    const tmdbIds = toUpdate.map((m: any) => Number(m.tmdb_id));
                    try {
                        await neonSql`
                            UPDATE medias SET tmdb_id = tmp.tmdb_id::int
                            FROM (SELECT unnest(${anilistIds}::int[]) AS anilist_id, unnest(${tmdbIds}::int[]) AS tmdb_id) AS tmp
                            WHERE medias.anilist_id = tmp.anilist_id AND medias.tmdb_id IS NULL
                        `;
                    } catch (dbErr: any) {
                        console.error(`⚠️ Neon update error for batch ${i}: ${dbErr.message}`);
                    }
                }
            }

            if (i % 1000 === 0) console.log(`✅ Processed ${i} items...`);
        }

        if (neonSql) await neonSql.end();
        console.log('🎉 Fribb mapping update complete !');
    } catch (error: any) {
        console.error('❌ Fribb Update Error:', error.message);
    }
}

export default updateFribbMapping;
