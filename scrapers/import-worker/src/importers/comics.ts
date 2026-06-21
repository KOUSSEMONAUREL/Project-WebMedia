import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';

const COMICVINE_URL = 'https://comicvine.gamespot.com/api/volumes';

export async function importComics(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null) {
    const db = createDbClient(databaseUrl, 'neon');

    console.log("🚀 Starting Comic Vine Import...");

    try {
        const response = await axios.get(COMICVINE_URL, {
            params: {
                api_key: apiKey,
                format: 'json',
                sort: 'date_added:desc',
                limit: 50,
                field_list: 'id,name,description,image,start_year,deck'
            }
        });

        if (!response.data.results) return;

        for (const item of response.data.results) {
            try {
                const externalId = `cv-${item.id}`;
                const existing = await db.select().from(medias).where(eq(medias.externalId, externalId)).limit(1);
                if (existing.length > 0) continue;

                const title = item.name;
                const [insertedMedia] = await db.insert(medias).values({
                    type: 'comic',
                    title: title,
                    slug: `comic-${item.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
                    synopsis: item.deck || item.description,
                    year: item.start_year ? parseInt(item.start_year) : null,
                    posterUrl: item.image?.super_url || item.image?.original_url,
                    externalId: externalId,
                    metadataSource: 'comicvine',
                    metadataFreshAt: new Date()
                }).onConflictDoNothing().returning();

                if (insertedMedia && internalApiUrl && internalApiKey) {
                    try {
                        await axios.post(`${internalApiUrl}/ingest/media`, {
                            id: insertedMedia.id,
                            type: 'comic',
                            metadata_ok: 1
                        }, {
                            headers: { 'X-Internal-API-Key': internalApiKey }
                        });
                    } catch (e: any) {
                        console.error(`⚠️ Failed to notify Brain for COMIC ${title}: ${e.message}`);
                    }
                }

                console.log(`✅ [COMIC] Imported: ${title}`);
            } catch (err) { }
        }
    } catch (err: any) {
        console.error("Comic Vine Error:", err.message);
    }
}
