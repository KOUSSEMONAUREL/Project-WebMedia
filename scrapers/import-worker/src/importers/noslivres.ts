import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const NOSLIVRES_API = 'https://api.noslivres.fr/api/v1';
const KEY = 'noslivres';

export async function importPopularBooksFR(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting NosLivres Import (limit=${limit})...`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const response = await withRetry(() => axios.get(`${NOSLIVRES_API}/books/popular`, {
            params: { page, pageSize: limit },
            headers: { 'User-Agent': 'WebMedia/1.0' }
        }));

        const results = response.data?.data || response.data || [];
        if (!Array.isArray(results) || results.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            console.log('📄 Fin catalogue NosLivres, retour page 1');
            return 0;
        }

        // Batch check slugs
        const slugs = results.map((book: any) =>
            `nl-${book.id}-${book.attributes?.title?.toLowerCase().substring(0, 60).replace(/[^a-z0-9]+/g, '-') || book.id}`
        );
        const existingSlugs = await batchCheckExisting(db, medias.slug, slugs);

        let importedCount = 0;
        for (let i = 0; i < results.length; i++) {
            const book = results[i];
            if (existingSlugs.has(slugs[i])) continue;

            const title = book.attributes?.title || 'Titre inconnu';
            const externalId = `nl-${book.id}`;
            const slug = slugs[i];

            try {
                const [media] = await db.insert(medias).values({
                    type: 'book', title, slug, externalId,
                    synopsis: book.attributes?.description,
                    posterUrl: book.attributes?.cover,
                    metadataSource: 'noslivres', metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    const bookUrl = book.attributes?.url || `https://noslivres.fr/livres/${book.id}`;
                    await db.insert(liens).values({
                        mediaId: media.id, sourceSite: 'noslivres',
                        url: bookUrl, quality: 'original', language: 'FR',
                    }).onConflictDoNothing().catch(() => {});
                    importedCount++;
                }
            } catch {}
        }

        await setOffset(KEY, page + 1, databaseUrl);
        console.log(`✅ NosLivres: ${importedCount} ajoutés (page ${page})`);
        return importedCount;
    } catch (error: any) {
        console.error('NosLivres Import Error:', error.message);
        throw error;
    }
}
