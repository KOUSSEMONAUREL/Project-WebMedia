import axios from 'axios';

const FRIBB_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || (process.env.ENVIRONMENT === 'development' ? 'http://localhost:8787/api/internal' : 'https://api.webmedia.com/api/internal');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function updateFribbMapping() {
    console.log('📡 Downloading Fribb mapping data...');

    try {
        const response = await axios.get(FRIBB_URL);
        const data = response.data; // Array of anime mappings

        console.log(`📊 Processing ${data.length} mappings...`);

        // On envoie les données au backend par petits lots (batching)
        // car D1 ne peut pas encaisser 20k inserts d'un coup
        const BATCH_SIZE = 100;
        for (let i = 0; i < data.length; i += BATCH_SIZE) {
            const batch = data.slice(i, i + BATCH_SIZE).map((item: any) => ({
                anilist_id: item.anilist_id,
                tmdb_id: item.themoviedb_id,
                mal_id: item.mal_id,
                imdb_id: item.imdb_id
            })).filter((item: any) => item.anilist_id); // On ne garde que ceux avec Anilist ID

            if (batch.length === 0) continue;

            // Appel au backend pour insérer dans D1
            // On va supposer qu'il existe une route d'ingestion massive pour D1
            await axios.post(`${INTERNAL_API_URL}/ingest/mapping`, { mappings: batch }, {
                headers: { 'X-Internal-API-Key': INTERNAL_API_KEY }
            });

            if (i % 1000 === 0) console.log(`✅ Processed ${i} items...`);
        }

        console.log('🎉 Fribb mapping update complete !');
    } catch (error: any) {
        console.error('❌ Fribb Update Error:', error.message);
    }
}

// Suppression du bloc auto-exécution car incompatible ESM pur
// et géré par index.ts
export default updateFribbMapping;
