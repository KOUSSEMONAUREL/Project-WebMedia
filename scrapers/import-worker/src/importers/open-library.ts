import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';

const OPEN_LIBRARY_API = 'https://openlibrary.org';

export async function importOpenLibrary(databaseUrl: string, search: string = 'popular') {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Open Library Import for: ${search}...`);

    try {
        const response = await axios.get(`${OPEN_LIBRARY_API}/search.json`, {
            params: { q: search, limit: 20 }
        });

        const results = response.data.docs;
        let importedCount = 0;

        for (const item of results) {
            const externalId = item.key.replace('/works/', '');
            const title = item.title;
            const slug = `book-ol-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);

            const existing = await db.select().from(medias).where(eq(medias.slug, slug)).limit(1);

            if (existing.length === 0) {
                const [media] = await db.insert(medias).values({
                    type: 'novel',
                    title,
                    originalTitle: title,
                    synopsis: item.first_sentence ? item.first_sentence[0] : '',
                    posterUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : undefined,
                    externalId,
                    slug,
                    metadataSource: 'openlibrary',
                    metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    await db.insert(liens).values({
                        mediaId: media.id,
                        sourceSite: 'openlibrary',
                        url: `${OPEN_LIBRARY_API}${item.key}`,
                        quality: 'original',
                        language: 'EN'
                    });
                    importedCount++;
                }
            }
        }
        console.log(`✅ Open Library import complete: ${importedCount} added.`);
    } catch (error: any) {
        console.error('❌ Open Library Import Error:', error.message);
    }
}
