import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const COMICVINE_URL = 'https://comicvine.gamespot.com/api/volumes';
const KEY = 'comicvine';

export async function importComics(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Comic Vine Import (limit=${limit})...`);

    try {
        const offset = await getOffset(KEY, databaseUrl, 0);
        const response = await axios.get(COMICVINE_URL, {
            params: {
                api_key: apiKey, format: 'json', sort: 'date_added:desc',
                limit, offset, field_list: 'id,name,description,image,start_year,deck'
            }
        });

        const results = response.data.results || [];
        if (results.length === 0) {
            await setOffset(KEY, 0, databaseUrl);
            console.log('📄 Fin catalogue ComicVine, retour offset 0');
            return 0;
        }

        const externalIds = results.map((r: any) => `cv-${r.id}`);
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        let importedCount = 0;
        for (const item of results) {
            const externalId = `cv-${item.id}`;
            if (existing.has(externalId)) continue;

            const title = item.name;
            try {
                const [insertedMedia] = await db.insert(medias).values({
                    type: 'comic', title,
                    slug: `comic-${item.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
                    synopsis: item.deck || item.description, year: item.start_year ? parseInt(item.start_year) : null,
                    posterUrl: item.image?.super_url || item.image?.original_url, externalId,
                    metadataSource: 'comicvine', metadataFreshAt: new Date()
                }).onConflictDoNothing().returning();

                if (insertedMedia) {
                    await notifyBrain(insertedMedia.id, 'comic', internalApiUrl!, internalApiKey!);
                    importedCount++;
                    console.log(`✅ [COMIC] ${title}`);
                }
            } catch {}
        }

        await setOffset(KEY, offset + limit, databaseUrl);
        console.log(`✅ ComicVine: ${importedCount} ajoutés (offset ${offset})`);
        return importedCount;
    } catch (err: any) {
        console.error('Comic Vine Error:', err.message);
        throw err;
    }
}
