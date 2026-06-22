import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const PG_API = 'https://www.gutenberg.org/ebooks/search.json';
const KEY = 'gutenberg';

export async function importGutenberg(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Project Gutenberg Import (limit=${limit})...`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const response = await axios.get(PG_API, {
            params: { query: 'popular', per_page: limit, page },
            headers: { 'User-Agent': 'WebMedia/1.0 (Metadata Import Worker)' }
        });

        const results = (response.data.results || []).slice(0, limit);
        if (results.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            console.log('📄 Fin catalogue Project Gutenberg, retour page 1');
            return 0;
        }

        const externalIds = results.map((item: any) => item.id);
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        let importedCount = 0;
        for (const item of results) {
            const externalId = item.id.toString();
            if (existing.has(externalId)) continue;

            const title = item.title;
            const authors = item.authors?.map((a: any) => a.name).join(', ') || 'Unknown';
            const slug = `book-gb-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);

            try {
                const [media] = await db.insert(medias).values({
                    type: 'novel', title, originalTitle: title,
                    synopsis: `Auteur(s): ${authors}`,
                    posterUrl: item.cover_image ? `https:${item.cover_image}` : undefined,
                    externalId, slug,
                    metadataSource: 'gutenberg', metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    const bookUrl = `https://www.gutenberg.org/ebooks/${externalId}`;
                    await db.insert(liens).values({
                        mediaId: media.id, sourceSite: 'gutenberg',
                        url: bookUrl, quality: 'original', language: 'EN',
                    }).onConflictDoNothing().catch(() => {});
                    importedCount++;
                }
            } catch {}
        }

        await setOffset(KEY, page + 1, databaseUrl);
        console.log(`✅ Project Gutenberg: ${importedCount} ajoutés (page ${page})`);
        return importedCount;
    } catch (error: any) {
        console.error('❌ Project Gutenberg Import Error:', error.message);
        throw error;
    }
}
