import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const OPEN_LIBRARY_API = 'https://openlibrary.org';
const KEY = 'openlibrary';

export async function importOpenLibrary(databaseUrl: string, search: string = 'popular', limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Open Library Import (search=${search}, limit=${limit})...`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const response = await withRetry(() => axios.get(`${OPEN_LIBRARY_API}/search.json`, {
            params: { q: search, page, limit }
        }));

        const results = (response.data.docs || []).slice(0, limit);
        if (results.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            console.log('📄 Fin catalogue OpenLibrary, retour page 1');
            return 0;
        }

        const slugs = results.map((item: any) =>
            `book-ol-${item.key.replace('/works/', '')}-${item.title?.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490)
        );
        const existing = await batchCheckExisting(db, medias.slug, slugs);

        let importedCount = 0;
        for (const item of results) {
            const externalId = item.key.replace('/works/', '');
            const title = item.title;
            const slug = `book-ol-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
            if (existing.has(slug)) continue;

            try {
                const [media] = await db.insert(medias).values({
                    type: 'book', title, originalTitle: title,
                    synopsis: item.first_sentence ? item.first_sentence[0] : '',
                    posterUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : undefined,
                    externalId, slug, metadataSource: 'openlibrary', metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    await db.insert(liens).values({
                        mediaId: media.id, sourceSite: 'openlibrary',
                        url: `${OPEN_LIBRARY_API}${item.key}`,
                        quality: 'original', language: 'EN'
                    });
                    importedCount++;
                }
            } catch {}
        }

        await setOffset(KEY, page + 1, databaseUrl);
        console.log(`✅ OpenLibrary: ${importedCount} ajoutés (page ${page})`);
        return importedCount;
    } catch (error: any) {
        console.error('❌ Open Library Import Error:', error.message);
        throw error;
    }
}
