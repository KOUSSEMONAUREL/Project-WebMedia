import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const PG_API = 'https://project-gutenberg-free-books-api1.p.rapidapi.com/books';
const KEY = 'gutenberg';

export async function importGutenberg(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Project Gutenberg Import (limit=${limit})...`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const response = await withRetry(() => axios.get(PG_API, {
            params: { q: 'popular', page_size: limit, page },
            headers: {
                'X-RapidAPI-Key': process.env.GUTENBERG_API_KEY || '',
                'X-RapidAPI-Host': 'project-gutenberg-free-books-api1.p.rapidapi.com'
            }
        }));

        const results = (response.data.results || []).slice(0, limit);
        if (results.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            console.log('📄 Fin catalogue Project Gutenberg, retour page 1');
            return 0;
        }

        const externalIds = results.map((item: any) => item.id.toString());
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        const toInsert = results.filter((item: any) => !existing.has(item.id.toString()));
        if (toInsert.length === 0) {
            console.log(`📄 Gutenberg page ${page}: tout existant déjà`);
            await setOffset(KEY, page + 1, databaseUrl);
            return 0;
        }

        const mediaValues = toInsert.map((item: any) => {
            const title = item.title;
            const externalId = item.id.toString();
            const authors = item.authors?.map((a: any) => a.name).join(', ') || 'Unknown';
            const slug = `book-gb-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
            return {
                type: 'book', title, originalTitle: title,
                synopsis: `Auteur(s): ${authors}`,
                posterUrl: item.cover_image || undefined,
                externalId, slug,
                metadataSource: 'gutenberg', metadataFreshAt: new Date()
            };
        });

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

        const lienValues = inserted.map(m => ({
            mediaId: m.id, sourceSite: 'gutenberg',
            url: `https://www.gutenberg.org/ebooks/${m.externalId}`,
            quality: 'original', language: 'EN',
        }));

        if (lienValues.length > 0) {
            await db.insert(liens).values(lienValues).onConflictDoNothing().catch(() => {});
        }

        console.log(`✅ Project Gutenberg: ${inserted.length} ajoutés (page ${page})`);
        return inserted.length;
    } catch (error: any) {
        console.error('❌ Project Gutenberg Import Error:', error.message);
        throw error;
    }
}
